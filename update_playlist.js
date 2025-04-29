const { google } = require('googleapis');
require('dotenv').config();

// YouTube API 설정
const youtube = google.youtube('v3');

// 환경 변수 확인
const requiredEnvVars = [
    'YOUTUBE_API_KEY',
    'YOUTUBE_CLIENT_ID',
    'YOUTUBE_CLIENT_SECRET',
    'YOUTUBE_CHANNEL_ID'
];

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`${envVar} 환경 변수가 설정되지 않았습니다.`);
        process.exit(1);
    }
}

// OAuth2 클라이언트 설정
const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET
);

// 동영상 필터링 설정
const FILTER_CONFIG = {
    minDuration: 60, // 최소 1분
    includePatterns: [/\[MV\]/i, /\[Official Audio\]/i]
};

// 동영상 상세 정보 가져오기
async function getVideoDetails(videoId) {
    try {
        const response = await youtube.videos.list({
            key: process.env.YOUTUBE_API_KEY,
            part: 'contentDetails,snippet',
            id: videoId
        });

        if (response.data.items && response.data.items.length > 0) {
            return response.data.items[0];
        }
        return null;
    } catch (error) {
        console.error(`동영상 ${videoId}의 상세 정보를 가져오는데 실패했습니다:`, error);
        return null;
    }
}

// 동영상 길이를 초 단위로 변환
function parseDuration(duration) {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;

    const hours = parseInt(match[1] || 0);
    const minutes = parseInt(match[2] || 0);
    const seconds = parseInt(match[3] || 0);

    return hours * 3600 + minutes * 60 + seconds;
}

// 동영상 필터링
function shouldIncludeVideo(video) {
    const title = video.snippet.title;

    // 포함할 패턴 확인
    for (const pattern of FILTER_CONFIG.includePatterns) {
        if (pattern.test(title)) {
            // 길이 확인
            const duration = parseDuration(video.contentDetails.duration);
            if (duration >= FILTER_CONFIG.minDuration) {
                return true;
            }
        }
    }

    return false;
}

// 플레이리스트 생성 또는 가져오기
async function getOrCreatePlaylist() {
    try {
        const savedPlaylistId = process.env.YOUTUBE_PLAYLIST_ID;
        if (savedPlaylistId) {
            try {
                await youtube.playlists.list({
                    auth: oauth2Client,
                    part: 'snippet',
                    id: savedPlaylistId
                });
                return savedPlaylistId;
            } catch (error) {
                console.log('저장된 플레이리스트가 존재하지 않습니다. 새로 생성합니다.');
            }
        }

        const response = await youtube.playlists.insert({
            auth: oauth2Client,
            part: 'snippet,status',
            requestBody: {
                snippet: {
                    title: 'Daily Music Updates',
                    description: 'Automatically updated playlist with latest music from subscribed channels'
                },
                status: {
                    privacyStatus: 'private'
                }
            }
        });

        const playlistId = response.data.id;
        console.log('새 플레이리스트가 생성되었습니다. 다음 GitHub Secrets에 이 ID를 추가해주세요:');
        console.log('YOUTUBE_PLAYLIST_ID:', playlistId);
        return playlistId;
    } catch (error) {
        console.error('플레이리스트 생성/가져오기 중 오류가 발생했습니다:', error);
        throw error;
    }
}

// 플레이리스트 비우기
async function clearPlaylist(playlistId) {
    try {
        const response = await youtube.playlistItems.list({
            auth: oauth2Client,
            part: 'id',
            playlistId: playlistId,
            maxResults: 50
        });

        for (const item of response.data.items) {
            await youtube.playlistItems.delete({
                auth: oauth2Client,
                id: item.id
            });
        }
    } catch (error) {
        console.error('플레이리스트 비우기 중 오류가 발생했습니다:', error);
        throw error;
    }
}

// 최신 동영상 가져오기
async function getLatestVideos(channelId) {
    try {
        const response = await youtube.search.list({
            key: process.env.YOUTUBE_API_KEY,
            channelId: channelId,
            part: 'snippet',
            maxResults: 10,
            order: 'date',
            type: 'video'
        });

        const videos = [];
        for (const item of response.data.items) {
            const videoDetails = await getVideoDetails(item.id.videoId);
            if (videoDetails && shouldIncludeVideo(videoDetails)) {
                videos.push({
                    id: item.id.videoId,
                    title: item.snippet.title,
                    channelName: item.snippet.channelTitle,
                    publishedAt: item.snippet.publishedAt,
                    duration: parseDuration(videoDetails.contentDetails.duration)
                });
            }
        }

        return videos;
    } catch (error) {
        console.error(`채널 ${channelId}의 동영상을 가져오는데 실패했습니다:`, error);
        return [];
    }
}

// 동영상을 플레이리스트에 추가
async function addVideoToPlaylist(playlistId, videoId) {
    try {
        await youtube.playlistItems.insert({
            auth: oauth2Client,
            part: 'snippet',
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
        console.error(`동영상 ${videoId} 추가 중 오류가 발생했습니다:`, error);
    }
}

// 플레이리스트 업데이트
async function updatePlaylist() {
    console.log('플레이리스트 업데이트 시작...');
    
    try {
        oauth2Client.setCredentials({
            access_token: process.env.YOUTUBE_ACCESS_TOKEN,
            refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
        });

        const playlistId = await getOrCreatePlaylist();
        await clearPlaylist(playlistId);
        
        const videos = await getLatestVideos(process.env.YOUTUBE_CHANNEL_ID);
        videos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

        for (const video of videos) {
            await addVideoToPlaylist(playlistId, video.id);
            console.log(`동영상 추가: ${video.title} (${Math.floor(video.duration / 60)}분 ${video.duration % 60}초)`);
        }

        console.log('플레이리스트가 업데이트되었습니다.');
        console.log(`총 ${videos.length}개의 동영상이 추가되었습니다.`);
    } catch (error) {
        console.error('플레이리스트 업데이트 중 오류가 발생했습니다:', error);
        throw error;
    }
}

// 실행
updatePlaylist().catch(error => {
    console.error('플레이리스트 업데이트 중 오류가 발생했습니다:', error);
    process.exit(1); 
}); 