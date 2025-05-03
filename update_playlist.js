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
            const publishedAfter = new Date();
            publishedAfter.setDate(publishedAfter.getDate() - 10);
            const publishedAfterString = publishedAfter.toISOString();

            const response = await this.youtube.search.list({
                auth: this.oauth2Client,
                channelId: channelId,
                part: 'snippet',
                maxResults: CONSTANTS.API.BATCH_SIZE,
                order: 'date',
                publishedAfter: publishedAfterString
            });

            if (!response.data.items || response.data.items.length === 0) {
                Logger.warn('검색 결과가 없습니다.');
                return [];
            }

            response.data.items.forEach(item => {
                console.log('item', item);
            });

            // 제목으로 필터링
            const filteredItems = response.data.items.filter(item => 
                CONSTANTS.VIDEO.INCLUDE_PATTERNS.some(pattern => 
                    pattern.test(item.snippet.title)
                )
            );

            Logger.info(`검색 결과 중 ${filteredItems.length}개의 동영상이 필터링되었습니다.`);

            // 필터링된 동영상 추가 (최대 20개)
            const videos = filteredItems
                .slice(0, CONSTANTS.API.MAX_RESULTS)  // 최대 20개로 제한
                .map(item => ({
                    id: item.id.videoId,
                    title: item.snippet.title,
                    channelName: item.snippet.channelTitle,
                    publishedAt: item.snippet.publishedAt
                }));

            Logger.info('최종 선택된 동영상 목록:');
            videos.forEach((video, index) => {
                Logger.info(`${index + 1}. ${video.title} (${video.publishedAt})`);
            });

            return videos;
        } catch (error) {
            if (error.code === 403 && error.message.includes('quotaExceeded')) {
                Logger.error('YouTube API 할당량이 초과되었습니다. 24시간 후에 다시 시도해주세요.');
            } else {
                Logger.error(`채널 ${channelId}의 동영상을 가져오는데 실패했습니다: ${error.message}`);
            }
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

    async updatePlaylistItems(playlistId, videos) {
        try {
            // 플레이리스트의 현재 아이템 가져오기
            const currentItems = await this.getPlaylistItems(playlistId);
            
            // 기존 동영상 모두 삭제
            for (const item of currentItems) {
                await this.youtube.playlistItems.delete({
                    auth: this.oauth2Client,
                    id: item.id
                });
                Logger.info(`기존 동영상 제거: ${item.snippet.title}`);
            }

            // 새 동영상 추가 (최신순으로)
            for (const video of videos) {
                await this.youtube.playlistItems.insert({
                    auth: this.oauth2Client,
                    part: 'snippet',
                    resource: {
                        snippet: {
                            playlistId: playlistId,
                            resourceId: {
                                kind: 'youtube#video',
                                videoId: video.id
                            }
                        }
                    }
                });
                Logger.info(`동영상 추가 완료: ${video.title}`);
            }

            Logger.info('플레이리스트가 성공적으로 업데이트되었습니다.');
        } catch (error) {
            if (error.code === 403 && error.message.includes('quotaExceeded')) {
                Logger.error('YouTube API 할당량이 초과되었습니다. 24시간 후에 다시 시도해주세요.');
            } else {
                Logger.error('플레이리스트 업데이트 중 오류가 발생했습니다:', error.message);
            }
            throw error;
        }
    }

    async getPlaylistItems(playlistId) {
        try {
            const response = await this.youtube.playlistItems.list({
                auth: this.oauth2Client,
                part: 'snippet',
                playlistId: playlistId,
                maxResults: 50
            });
            return response.data.items;
        } catch (error) {
            Logger.error('플레이리스트 아이템을 가져오는데 실패했습니다:', error.message);
            return [];
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

        const channelId = process.env.YOUTUBE_CHANNEL_ID;
        if (!channelId) {
            throw new Error('채널 ID가 설정되지 않았습니다.');
        }
        Logger.info(`채널 ID: ${channelId}`);

        Logger.info(`채널 ${channelId}의 최신 동영상을 가져오는 중...`);
        const videos = await videoCollector.getLatestVideos(channelId);
        if (videos.length === 0) {
            Logger.warn('가져올 수 있는 동영상이 없습니다.');
            return;
        }

        Logger.info(`${videos.length}개의 동영상을 찾았습니다.`);
        await playlistManager.updatePlaylistItems(process.env.YOUTUBE_PLAYLIST_ID, videos);

        Logger.info('플레이리스트 업데이트가 완료되었습니다.');
    } catch (error) {
        if (error.code === 403 && error.message.includes('quotaExceeded')) {
            Logger.error('YouTube API 할당량이 초과되었습니다. 24시간 후에 다시 시도해주세요.');
        } else if (error.code === 404) {
            Logger.error('채널을 찾을 수 없습니다. 채널 ID를 확인해주세요.');
        } else {
            Logger.error('플레이리스트 업데이트 중 오류가 발생했습니다:', error.message);
        }
        throw error;
    }
}

// 실행
updatePlaylist().catch(error => {
    Logger.error('프로그램 실행 중 오류가 발생했습니다', error);
    process.exit(1);
});