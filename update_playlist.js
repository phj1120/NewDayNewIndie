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
        Utils.validateEnvVars();
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
        this.lastApiCall = 0;
        this.minApiCallInterval = 1000; // API 호출 간 최소 간격 (ms)
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async ensureApiCallInterval() {
        const now = Date.now();
        const timeSinceLastCall = now - this.lastApiCall;
        if (timeSinceLastCall < this.minApiCallInterval) {
            await this.sleep(this.minApiCallInterval - timeSinceLastCall);
        }
        this.lastApiCall = Date.now();
    }

    async getLatestVideos(channelId) {
        try {
            let videos = [];
            let nextPageToken = null;
            let totalAttempts = 0;
            const maxTotalAttempts = 5; // 최대 시도 횟수
            
            while (videos.length < CONSTANTS.API.MAX_RESULTS && totalAttempts < maxTotalAttempts) {
                await this.ensureApiCallInterval();
                
                const response = await Utils.retry(
                    async () => {
                        try {
                            return await this.youtube.search.list({
                                auth: this.oauth2Client,
                                channelId: channelId,
                                part: CONSTANTS.API.PARTS.SNIPPET,
                                maxResults: CONSTANTS.API.BATCH_SIZE,
                                order: 'date',
                                type: 'video',
                                pageToken: nextPageToken
                            });
                        } catch (error) {
                            if (error.response) {
                                Logger.error(`검색 API 응답 오류: ${error.response.status} - ${error.response.statusText}`);
                            }
                            throw error;
                        }
                    },
                    this
                );

                if (!response.data.items || response.data.items.length === 0) {
                    Logger.warn('더 이상 검색 결과가 없습니다.');
                    break;
                }

                // 제목만으로 필터링
                const filteredItems = response.data.items.filter(item => 
                    CONSTANTS.VIDEO.INCLUDE_PATTERNS.some(pattern => 
                        pattern.test(item.snippet.title)
                    )
                );

                Logger.info(`검색 결과 중 ${filteredItems.length}개의 동영상이 필터링되었습니다.`);

                // 필터링된 동영상 추가
                for (const item of filteredItems) {
                    if (videos.length >= CONSTANTS.API.MAX_RESULTS) break;

                    videos.push({
                        id: item.id.videoId,
                        title: item.snippet.title,
                        channelName: item.snippet.channelTitle,
                        publishedAt: item.snippet.publishedAt
                    });
                    Logger.info(`동영상 추가됨: ${item.snippet.title}`);
                }

                nextPageToken = response.data.nextPageToken;
                if (!nextPageToken) {
                    Logger.info('더 이상 페이지가 없습니다.');
                    break;
                }

                totalAttempts++;
                if (totalAttempts >= maxTotalAttempts) {
                    Logger.warn('최대 시도 횟수에 도달했습니다.');
                    break;
                }
            }

            return videos.slice(0, CONSTANTS.API.MAX_RESULTS);
        } catch (error) {
            Logger.error(`채널 ${channelId}의 동영상을 가져오는데 실패했습니다`, error);
            if (error.response) {
                Logger.error(`API 응답: ${JSON.stringify(error.response.data)}`);
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
        this.youtubeClient = youtubeClient;
        this.playlistCache = new Map();
        this.cacheExpiryTime = 5 * 60 * 1000; // 5분
    }

    async ensureValidToken() {
        await this.youtubeClient.refreshTokenIfNeeded();
    }

    async getOrCreatePlaylist() {
        try {
            await this.ensureValidToken();
            
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
            const response = await Utils.retry(
                async () => {
                    await this.ensureValidToken();
                    return this.youtube.playlists.insert({
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
                },
                this,
                CONSTANTS.API.RETRY.MAX_ATTEMPTS,
                (error) => {
                    if (error.code === 401) {
                        return true; // 인증 오류는 재시도
                    }
                    return error.code !== 404; // 404 에러는 재시도하지 않음
                }
            );

            const newPlaylistId = response.data.id;
            Logger.info(`새 플레이리스트가 생성되었습니다: ${newPlaylistId}`);
            return newPlaylistId;
        } catch (error) {
            Logger.error('플레이리스트 생성/조회 중 오류가 발생했습니다', error);
            throw error;
        }
    }

    async getPlaylistItems(playlistId) {
        // 캐시 확인
        const cachedData = this.playlistCache.get(playlistId);
        if (cachedData && Date.now() < cachedData.expiryTime) {
            return cachedData.items;
        }

        try {
            await this.ensureValidToken();
            
            const response = await Utils.retry(
                async () => {
                    await this.ensureValidToken();
                    return this.youtube.playlistItems.list({
                        auth: this.oauth2Client,
                        part: CONSTANTS.API.PARTS.SNIPPET,
                        playlistId: playlistId,
                        maxResults: CONSTANTS.API.MAX_RESULTS
                    });
                },
                this,
                CONSTANTS.API.RETRY.MAX_ATTEMPTS,
                (error) => {
                    if (error.code === 401) {
                        return true; // 인증 오류는 재시도
                    }
                    return error.code !== 404; // 404 에러는 재시도하지 않음
                }
            );

            const items = response.data.items || [];
            this.playlistCache.set(playlistId, {
                items,
                expiryTime: Date.now() + this.cacheExpiryTime
            });
            return items;
        } catch (error) {
            Logger.error('플레이리스트 항목을 가져오는데 실패했습니다', error);
            return [];
        }
    }

    async updatePlaylistItems(playlistId, newVideos) {
        try {
            await this.ensureValidToken();
            
            const existingItems = await this.getPlaylistItems(playlistId);
            const existingVideoIds = new Set(existingItems.map(item => item.snippet.resourceId.videoId));

            // 새로운 동영상 추가
            const videosToAdd = newVideos.filter(video => !existingVideoIds.has(video.id));
            for (const video of videosToAdd) {
                await Utils.retry(
                    async () => {
                        await this.ensureValidToken();
                        return this.addVideoToPlaylist(playlistId, video.id);
                    },
                    this,
                    CONSTANTS.API.RETRY.MAX_ATTEMPTS,
                    (error) => {
                        if (error.code === 401) {
                            return true; // 인증 오류는 재시도
                        }
                        return error.code !== 404; // 404 에러는 재시도하지 않음
                    }
                );
                Logger.info(`동영상 추가: ${video.title}`);
            }

            // 최대 개수 초과 시 오래된 항목 제거
            const totalItems = existingItems.length + videosToAdd.length;
            if (totalItems > CONSTANTS.API.MAX_RESULTS) {
                const itemsToRemove = existingItems.slice(0, totalItems - CONSTANTS.API.MAX_RESULTS);
                for (const item of itemsToRemove) {
                    await Utils.retry(
                        async () => {
                            await this.ensureValidToken();
                            return this.youtube.playlistItems.delete({
                                auth: this.oauth2Client,
                                id: item.id
                            });
                        },
                        this,
                        CONSTANTS.API.RETRY.MAX_ATTEMPTS,
                        (error) => {
                            if (error.code === 401) {
                                return true; // 인증 오류는 재시도
                            }
                            return error.code !== 404; // 404 에러는 재시도하지 않음
                        }
                    );
                    Logger.info(`동영상 제거: ${item.snippet.title}`);
                }
            }

            // 캐시 업데이트
            this.playlistCache.delete(playlistId);
        } catch (error) {
            Logger.error('플레이리스트 업데이트 중 오류가 발생했습니다', error);
            throw error;
        }
    }

    async addVideoToPlaylist(playlistId, videoId) {
        try {
            await this.ensureValidToken();
            
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