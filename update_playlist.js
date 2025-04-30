const { google } = require('googleapis');
require('dotenv').config();

// 상수 정의
const CONSTANTS = {
    API: {
        VERSION: 'v3',
        BATCH_SIZE: 50,
        MAX_RESULTS: 20,
        PARTS: {
            SNIPPET: 'snippet'
        },
        RETRY: {
            MAX_ATTEMPTS: 3,
            INITIAL_DELAY: 1000,
            MAX_DELAY: 10000
        }
    },
    VIDEO: {
        INCLUDE_PATTERNS: [/\[MV\]/i, /\[Official Audio\]/i]
    },
    PLAYLIST: {
        TITLE: 'Daily Music Updates',
        DESCRIPTION: 'Automatically updated playlist with latest music from subscribed channels',
        PRIVACY: 'private'
    }
};

// 로깅 유틸리티
class Logger {
    static info(message) {
        console.log(`[INFO] ${message}`);
    }

    static error(message, error = null) {
        console.error(`[ERROR] ${message}`, error ? `\n${error.stack}` : '');
    }

    static warn(message) {
        console.warn(`[WARN] ${message}`);
    }
}

// 유틸리티 함수
class Utils {
    static async retry(fn, context, maxAttempts = CONSTANTS.API.RETRY.MAX_ATTEMPTS, shouldRetry = () => true) {
        let attempt = 0;
        let lastError;

        while (attempt < maxAttempts) {
            try {
                return await fn.call(context);
            } catch (error) {
                lastError = error;
                attempt++;
                
                if (attempt === maxAttempts || !shouldRetry(error)) {
                    throw error;
                }

                const delay = Math.min(
                    CONSTANTS.API.RETRY.INITIAL_DELAY * Math.pow(2, attempt - 1),
                    CONSTANTS.API.RETRY.MAX_DELAY
                );
                
                Logger.warn(`시도 ${attempt}/${maxAttempts} 실패. ${delay}ms 후 재시도...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }

    static validateEnvVars() {
        const missingVars = ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_CHANNEL_ID', 'YOUTUBE_PLAYLIST_ID', 'YOUTUBE_ACCESS_TOKEN', 'YOUTUBE_REFRESH_TOKEN'].filter(envVar => !process.env[envVar]);
        if (missingVars.length > 0) {
            throw new Error(`필수 환경 변수가 설정되지 않았습니다: ${missingVars.join(', ')}`);
        }

        // 환경 변수 값 검증
        if (!process.env.YOUTUBE_CHANNEL_ID.startsWith('UC')) {
            throw new Error('유효하지 않은 채널 ID입니다. UC로 시작해야 합니다.');
        }

        if (process.env.YOUTUBE_PLAYLIST_ID && !process.env.YOUTUBE_PLAYLIST_ID.startsWith('PL')) {
            throw new Error('유효하지 않은 플레이리스트 ID입니다. PL로 시작해야 합니다.');
        }
    }
}

// YouTube API 클라이언트
class YouTubeClient {
    constructor() {
        this.youtube = google.youtube(CONSTANTS.API.VERSION);
        this.oauth2Client = new google.auth.OAuth2(
            process.env.YOUTUBE_CLIENT_ID,
            process.env.YOUTUBE_CLIENT_SECRET
        );
    }

    setCredentials() {
        this.oauth2Client.setCredentials({
            access_token: process.env.YOUTUBE_ACCESS_TOKEN,
            refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
        });
    }
}

// 동영상 수집기
class VideoCollector {
    constructor(youtubeClient) {
        this.youtube = youtubeClient.youtube;
        this.oauth2Client = youtubeClient.oauth2Client;
    }

    async getLatestVideos(channelId) {
        try {
            let videos = [];
            let nextPageToken = null;
            
            while (videos.length < CONSTANTS.API.MAX_RESULTS) {
                const response = await this.youtube.search.list({
                    auth: this.oauth2Client,
                    channelId: channelId,
                    part: CONSTANTS.API.PARTS.SNIPPET,
                    maxResults: CONSTANTS.API.BATCH_SIZE,
                    order: 'date',
                    type: 'video',
                    pageToken: nextPageToken
                });

                if (!response.data.items || response.data.items.length === 0) {
                    Logger.warn('더 이상 검색 결과가 없습니다.');
                    break;
                }

                // 제목으로 필터링
                const filteredItems = response.data.items.filter(item => 
                    CONSTANTS.VIDEO.INCLUDE_PATTERNS.some(pattern => 
                        pattern.test(item.snippet.title)
                    )
                );

                Logger.info(`검색 결과 중 ${filteredItems.length}개의 동영상이 필터링되었습니다.`);

                // 필터링된 동영상 추가
                for (const item of filteredItems) {
                    videos.push({
                        id: item.id.videoId,
                        title: item.snippet.title,
                        channelName: item.snippet.channelTitle,
                        publishedAt: item.snippet.publishedAt
                    });
                    Logger.info(`동영상 추가됨: ${item.snippet.title} (${item.snippet.publishedAt})`);
                }

                nextPageToken = response.data.nextPageToken;
                if (!nextPageToken) {
                    Logger.info('더 이상 페이지가 없습니다.');
                    break;
                }
            }

            // 날짜순으로 정렬하고 최신 20개만 반환
            return videos
                .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
                .slice(0, CONSTANTS.API.MAX_RESULTS);
        } catch (error) {
            Logger.error(`채널 ${channelId}의 동영상을 가져오는데 실패했습니다`, error);
            return [];
        }
    }
}

// 플레이리스트 관리자
class PlaylistManager {
    constructor(youtubeClient) {
        this.youtube = youtubeClient.youtube;
        this.oauth2Client = youtubeClient.oauth2Client;
    }

    async getOrCreatePlaylist() {
        try {
            // 환경 변수에서 플레이리스트 ID 확인
            const playlistId = process.env.YOUTUBE_PLAYLIST_ID;
            if (playlistId) {
                // 플레이리스트가 존재하는지 확인
                try {
                    await this.youtube.playlists.list({
                        auth: this.oauth2Client,
                        part: 'snippet',
                        id: playlistId
                    });
                    return playlistId;
                } catch (error) {
                    Logger.warn(`플레이리스트 ${playlistId}가 존재하지 않습니다. 새로 생성합니다.`);
                }
            }

            // 플레이리스트 생성
            const response = await this.youtube.playlists.insert({
                auth: this.oauth2Client,
                part: 'snippet,status',
                requestBody: {
                    snippet: {
                        title: CONSTANTS.PLAYLIST.TITLE,
                        description: CONSTANTS.PLAYLIST.DESCRIPTION
                    },
                    status: {
                        privacyStatus: CONSTANTS.PLAYLIST.PRIVACY
                    }
                }
            });

            const newPlaylistId = response.data.id;
            Logger.info(`새 플레이리스트가 생성되었습니다: ${newPlaylistId}`);
            return newPlaylistId;
        } catch (error) {
            Logger.error('플레이리스트 생성/조회 중 오류가 발생했습니다', error);
            throw error;
        }
    }

    async getPlaylistItems(playlistId) {
        try {
            const response = await this.youtube.playlistItems.list({
                auth: this.oauth2Client,
                part: CONSTANTS.API.PARTS.SNIPPET,
                playlistId: playlistId,
                maxResults: CONSTANTS.API.MAX_RESULTS
            });

            return response.data.items || [];
        } catch (error) {
            Logger.error('플레이리스트 항목을 가져오는데 실패했습니다', error);
            return [];
        }
    }

    async updatePlaylistItems(playlistId, newVideos) {
        try {
            const existingItems = await this.getPlaylistItems(playlistId);
            const existingVideoIds = new Set(existingItems.map(item => item.snippet.resourceId.videoId));

            // 새로운 동영상 추가
            const videosToAdd = newVideos.filter(video => !existingVideoIds.has(video.id));
            for (const video of videosToAdd) {
                await this.addVideoToPlaylist(playlistId, video.id);
                Logger.info(`동영상 추가: ${video.title}`);
            }

            // 최대 개수 초과 시 오래된 항목 제거
            const totalItems = existingItems.length + videosToAdd.length;
            if (totalItems > CONSTANTS.API.MAX_RESULTS) {
                const itemsToRemove = existingItems.slice(0, totalItems - CONSTANTS.API.MAX_RESULTS);
                for (const item of itemsToRemove) {
                    await this.youtube.playlistItems.delete({
                        auth: this.oauth2Client,
                        id: item.id
                    });
                    Logger.info(`동영상 제거: ${item.snippet.title}`);
                }
            }
        } catch (error) {
            Logger.error('플레이리스트 업데이트 중 오류가 발생했습니다', error);
            throw error;
        }
    }

    async addVideoToPlaylist(playlistId, videoId) {
        try {
            await this.youtube.playlistItems.insert({
                auth: this.oauth2Client,
                part: CONSTANTS.API.PARTS.SNIPPET,
                requestBody: {
                    snippet: {
                        playlistId: playlistId,
                        resourceId: {
                            kind: 'youtube#video',
                            videoId: videoId
                        }
                    }
                }
            });
        } catch (error) {
            Logger.error(`동영상 ${videoId} 추가 중 오류가 발생했습니다`, error);
            throw error;
        }
    }
}

// 메인 실행 함수
async function updatePlaylist() {
    Logger.info('플레이리스트 업데이트 시작...');
    
    try {
        const youtubeClient = new YouTubeClient();
        youtubeClient.setCredentials();

        const playlistManager = new PlaylistManager(youtubeClient);
        const videoCollector = new VideoCollector(youtubeClient);

        const playlistId = await playlistManager.getOrCreatePlaylist();
        Logger.info(`플레이리스트 ID: ${playlistId}`);

        const channelId = process.env.YOUTUBE_CHANNEL_ID;
        if (!channelId) {
            throw new Error('채널 ID가 설정되지 않았습니다.');
        }

        Logger.info(`채널 ${channelId}의 최신 동영상을 가져오는 중...`);
        const videos = await videoCollector.getLatestVideos(channelId);
        
        if (videos.length === 0) {
            Logger.warn('가져올 수 있는 동영상이 없습니다.');
            return;
        }

        Logger.info(`${videos.length}개의 동영상을 찾았습니다.`);
        videos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

        Logger.info('플레이리스트 업데이트 중...');
        await playlistManager.updatePlaylistItems(playlistId, videos);

        Logger.info('플레이리스트 업데이트가 완료되었습니다.');
    } catch (error) {
        Logger.error('플레이리스트 업데이트 중 오류가 발생했습니다', error);
        throw error;
    }
}

// 실행
updatePlaylist().catch(error => {
    Logger.error('프로그램 실행 중 오류가 발생했습니다', error);
    process.exit(1);
}); 