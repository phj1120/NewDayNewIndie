const { google } = require('googleapis');
require('dotenv').config();

const CONSTANTS = {
    API: {
        VERSION: 'v3',
        BATCH_SIZE: 50,
        MAX_RESULTS: 20,
    },
    VIDEO: {
        INCLUDE_PATTERNS: [/\[MV\]/i, /\[Official Audio\]/i]
    },
};

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

class YouTubeClient {
    constructor() {
        this.youtube = google.youtube(CONSTANTS.API.VERSION);
        this.oauth2Client = new google.auth.OAuth2(
            process.env.YOUTUBE_CLIENT_ID,
            process.env.YOUTUBE_CLIENT_SECRET
        );
        this.oauth2Client.setCredentials({
            access_token: process.env.YOUTUBE_ACCESS_TOKEN,
            refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
        });
    }
}

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

            const filteredItems = response.data.items.filter(item => 
                CONSTANTS.VIDEO.INCLUDE_PATTERNS.some(pattern => 
                    pattern.test(item.snippet.title)
                )
            );

            Logger.info(`검색 결과 중 ${filteredItems.length}개의 동영상이 필터링되었습니다.`);

            const videos = filteredItems
                .slice(0, CONSTANTS.API.MAX_RESULTS) 
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

class PlaylistManager {
    // TODO 이렇게 매번 세팅해준느거도 별로인듯 하고
    constructor(youtubeClient) {
        this.youtube = youtubeClient.youtube;
        this.oauth2Client = youtubeClient.oauth2Client;
    }

    async updatePlaylistItems(playlistId, videos) {
        try {
            const currentItems = await this.getPlaylistItems(playlistId);
            
            // TODO 다 삭제하고 추가하면 API 할당량 소모가 많아 필요한 항목만 업데이트 하면 좋을 듯
            // 근데 굳이긴 하네....
            for (const item of currentItems) {
                await this.youtube.playlistItems.delete({
                    // TODO 토큰 설정을 이렇게 매번 한느건 별로고 한번에 할 수 있는 방법 고안...
                    auth: this.oauth2Client,
                    id: item.id
                });
                Logger.info(`기존 동영상 제거: ${item.snippet.title}`);
            }

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

async function updatePlaylist() {
    Logger.info('플레이리스트 업데이트 시작...');
    
    try {
        const youtubeClient = new YouTubeClient();

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

updatePlaylist().catch(error => {
    Logger.error('프로그램 실행 중 오류가 발생했습니다', error);
    process.exit(1);
});