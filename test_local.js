const { google } = require('googleapis');
require('dotenv').config();

// YouTube API 설정
const youtube = google.youtube('v3');

// OAuth2 클라이언트 설정
const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
);

async function testYouTubeAccess() {
    try {
        // OAuth2 토큰 설정
        oauth2Client.setCredentials({
            access_token: process.env.YOUTUBE_ACCESS_TOKEN,
            refresh_token: process.env.YOUTUBE_REFRESH_TOKEN
        });

        // 채널 정보 가져오기 테스트
        console.log('채널 정보 가져오기 테스트...');
        const channelResponse = await youtube.channels.list({
            auth: oauth2Client,
            part: 'snippet',
            id: process.env.YOUTUBE_CHANNEL_ID
        });
        console.log('채널 정보:', channelResponse.data.items[0].snippet.title);

        // 플레이리스트 생성 테스트
        console.log('\n플레이리스트 생성 테스트...');
        const playlistResponse = await youtube.playlists.insert({
            auth: oauth2Client,
            part: 'snippet,status',
            requestBody: {
                snippet: {
                    title: 'Test Playlist',
                    description: 'Test playlist created by DailyPli'
                },
                status: {
                    privacyStatus: 'private'
                }
            }
        });
        console.log('플레이리스트 생성 성공:', playlistResponse.data.id);

        // 플레이리스트 삭제
        console.log('\n테스트 플레이리스트 삭제...');
        await youtube.playlists.delete({
            auth: oauth2Client,
            id: playlistResponse.data.id
        });
        console.log('테스트 플레이리스트 삭제 완료');

    } catch (error) {
        console.error('테스트 중 오류 발생:', error);
        if (error.response) {
            console.error('상세 오류:', error.response.data);
        }
    }
}

// 실행
testYouTubeAccess(); 