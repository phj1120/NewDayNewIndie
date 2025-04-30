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
            let totalResults = 0;
            
            // 먼저 최근 100개의 동영상을 가져옴
            while (totalResults < 100) {
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

                totalResults += response.data.items.length;

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
            const sortedVideos = videos
                .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
                .slice(0, CONSTANTS.API.MAX_RESULTS);

            Logger.info('최종 선택된 동영상 목록:');
            sortedVideos.forEach((video, index) => {
                Logger.info(`${index + 1}. ${video.title} (${video.publishedAt})`);
            });

            return sortedVideos;
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

    async getPlaylistItems(playlistId) {
        try {
            let allItems = [];
            let nextPageToken = null;

            // 모든 페이지의 항목을 가져옴
            do {
                const response = await this.youtube.playlistItems.list({
                    auth: this.oauth2Client,
                    part: 'snippet',
                    playlistId: playlistId,
                    maxResults: 50,
                    pageToken: nextPageToken
                });

                allItems = allItems.concat(response.data.items || []);
                nextPageToken = response.data.nextPageToken;
            } while (nextPageToken);

            // 동영상 상세 정보 가져오기
            const videoIds = allItems.map(item => item.snippet.resourceId.videoId);
            const videoDetails = await this.youtube.videos.list({
                auth: this.oauth2Client,
                part: 'snippet',
                id: videoIds.join(',')
            });

            // 동영상 상세 정보와 플레이리스트 항목 매핑
            const videoMap = new Map(
                videoDetails.data.items.map(video => [
                    video.id,
                    {
                        publishedAt: new Date(video.snippet.publishedAt),
                        title: video.snippet.title
                    }
                ])
            );

            // 날짜순으로 정렬하고 중복 제거
            const uniqueItems = [];
            const seenVideoIds = new Set();

            allItems
                .sort((a, b) => 
                    videoMap.get(b.snippet.resourceId.videoId).publishedAt - 
                    videoMap.get(a.snippet.resourceId.videoId).publishedAt
                )
                .forEach(item => {
                    const videoId = item.snippet.resourceId.videoId;
                    if (!seenVideoIds.has(videoId)) {
                        seenVideoIds.add(videoId);
                        uniqueItems.push(item);
                    } else {
                        Logger.warn(`중복된 동영상 제거: ${item.snippet.title}`);
                        // 중복된 항목 삭제
                        this.youtube.playlistItems.delete({
                            auth: this.oauth2Client,
                            id: item.id
                        }).catch(error => {
                            Logger.error(`중복 동영상 삭제 실패: ${item.snippet.title}`, error);
                        });
                    }
                });

            return uniqueItems;
        } catch (error) {
            Logger.error('플레이리스트 항목을 가져오는데 실패했습니다', error);
            return [];
        }
    }

    async updatePlaylistItems(playlistId, newVideos) {
        try {
            const existingItems = await this.getPlaylistItems(playlistId);
            const existingVideoIds = new Set(existingItems.map(item => item.snippet.resourceId.videoId));

            // 새로운 동영상 추가 (중복 체크)
            const videosToAdd = newVideos.filter(video => !existingVideoIds.has(video.id));
            for (const video of videosToAdd) {
                await this.addVideoToPlaylist(playlistId, video.id);
                Logger.info(`동영상 추가: ${video.title} (${video.publishedAt})`);
            }

            // 모든 동영상의 상세 정보 가져오기
            const allVideoIds = [
                ...existingItems.map(item => item.snippet.resourceId.videoId),
                ...videosToAdd.map(video => video.id)
            ];
            const videoDetails = await this.youtube.videos.list({
                auth: this.oauth2Client,
                part: 'snippet',
                id: allVideoIds.join(',')
            });

            // 동영상 상세 정보 매핑
            const videoMap = new Map(
                videoDetails.data.items.map(video => [
                    video.id,
                    {
                        publishedAt: new Date(video.snippet.publishedAt),
                        title: video.snippet.title
                    }
                ])
            );

            // 모든 동영상을 날짜순으로 정렬하고 중복 제거
            const allVideos = [];
            const seenVideoIds = new Set();

            [
                ...existingItems.map(item => ({
                    id: item.snippet.resourceId.videoId,
                    title: videoMap.get(item.snippet.resourceId.videoId).title,
                    publishedAt: videoMap.get(item.snippet.resourceId.videoId).publishedAt,
                    playlistItemId: item.id
                })),
                ...videosToAdd.map(video => ({
                    ...video,
                    publishedAt: new Date(video.publishedAt)
                }))
            ]
                .sort((a, b) => b.publishedAt - a.publishedAt)
                .forEach(video => {
                    if (!seenVideoIds.has(video.id)) {
                        seenVideoIds.add(video.id);
                        allVideos.push(video);
                    } else {
                        Logger.warn(`중복된 동영상 제거: ${video.title}`);
                    }
                });

            // 최대 개수 초과 시 오래된 항목 제거
            if (allVideos.length > CONSTANTS.API.MAX_RESULTS) {
                const itemsToRemove = allVideos.slice(CONSTANTS.API.MAX_RESULTS);
                for (const item of itemsToRemove) {
                    if (item.playlistItemId) {
                        await this.youtube.playlistItems.delete({
                            auth: this.oauth2Client,
                            id: item.playlistItemId
                        });
                        Logger.info(`동영상 제거: ${item.title} (${item.publishedAt.toISOString()})`);
                    }
                }
            }

            // 플레이리스트 순서 재정렬
            const finalVideos = allVideos.slice(0, CONSTANTS.API.MAX_RESULTS);
            for (let i = 0; i < finalVideos.length; i++) {
                const video = finalVideos[i];
                if (video.playlistItemId) {
                    await this.youtube.playlistItems.update({
                        auth: this.oauth2Client,
                        part: 'snippet',
                        requestBody: {
                            id: video.playlistItemId,
                            snippet: {
                                playlistId: playlistId,
                                resourceId: {
                                    kind: 'youtube#video',
                                    videoId: video.id
                                },
                                position: i
                            }
                        }
                    });
                    Logger.info(`동영상 순서 변경: ${video.title} -> 위치 ${i + 1} (${video.publishedAt.toISOString()})`);
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

        const playlistId = await playlistManager.getPlaylistItems(process.env.YOUTUBE_PLAYLIST_ID);
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
        await playlistManager.updatePlaylistItems(process.env.YOUTUBE_PLAYLIST_ID, videos);

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