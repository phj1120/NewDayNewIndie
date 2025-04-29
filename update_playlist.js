const { google } = require('googleapis');

// YouTube API 설정
const youtube = google.youtube('v3');

// API 키를 환경 변수에서 가져오기
const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) {
    console.error('YOUTUBE_API_KEY 환경 변수가 설정되지 않았습니다.');
    process.exit(1);
}

// OAuth2 클라이언트 설정
const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
);

// 채널 ID를 환경 변수에서 가져오기
const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;
if (!CHANNEL_ID) {
    console.error('YOUTUBE_CHANNEL_ID 환경 변수가 설정되지 않았습니다.');
    process.exit(1);
}

// 플레이리스트 생성 또는 가져오기
async function getOrCreatePlaylist() {
    try {
        // 저장된 플레이리스트 ID 확인
        const savedPlaylistId = process.env.YOUTUBE_PLAYLIST_ID;
        if (savedPlaylistId) {
            try {
                // 플레이리스트가 존재하는지 확인
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

        // 새 플레이리스트 생성
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
        // 플레이리스트의 모든 동영상 가져오기
        const response = await youtube.playlistItems.list({
            auth: oauth2Client,
            part: 'id',
            playlistId: playlistId,
            maxResults: 50
        });

        // 각 동영상을 삭제
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
            key: API_KEY,
            channelId: channelId,
            part: 'snippet',
            maxResults: 10,
            order: 'date',
            type: 'video'
        });

        return response.data.items.map(item => ({
            id: item.id.videoId,
            title: item.snippet.title,
            channelName: item.snippet.channelTitle,
            publishedAt: item.snippet.publishedAt
        }));
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
        // OAuth2 토큰 설정
        oauth2Client.setCredentials({
            access_token: process.env.YOUTUBE_ACCESS_TOKEN,
            refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
        });

        // 플레이리스트 가져오기 또는 생성
        const playlistId = await getOrCreatePlaylist();
        
        // 플레이리스트 비우기
        await clearPlaylist(playlistId);
        
        // 채널의 최신 동영상 가져오기
        const videos = await getLatestVideos(CHANNEL_ID);

        // 최신순으로 정렬
        videos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

        // 동영상을 플레이리스트에 추가
        for (const video of videos) {
            await addVideoToPlaylist(playlistId, video.id);
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