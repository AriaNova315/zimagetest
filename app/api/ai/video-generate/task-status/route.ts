import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { evolinkAxios } from '@/lib/axios-config';
import { newStorage } from '@/lib/storage';
import { log, logError } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('taskId');

    if (!taskId) {
      return NextResponse.json({ code: 400, message: 'Missing taskId' }, { status: 400 });
    }

    log('[Video Task Status] 查询任务:', { user: session.user.email, taskId });

    const response = await evolinkAxios.get(`/v1/tasks/${taskId}`);
    const taskData = response.data;

    log('[Video Task Status] 任务状态:', { status: taskData.status, progress: taskData.progress });

    if (taskData.status === 'completed' && taskData.results?.length > 0) {
      // 上传视频到 R2
      try {
        const storage = newStorage();
        const resultUrl = taskData.results[0];
        const ext = resultUrl.split('.').pop()?.split('?')[0] || 'mp4';
        const now = new Date();
        const key = `ai-generated/videos/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getTime()}-${Math.random().toString(36).substring(2, 15)}.${ext}`;

        log('[Video Task Status] 上传视频到 R2:', key);
        const uploadResult = await storage.downloadAndUpload({
          url: resultUrl,
          key,
          contentType: `video/${ext}`,
          disposition: 'inline',
        });
        log('[Video Task Status] 视频上传成功:', uploadResult.url);

        return NextResponse.json({
          code: 1000,
          message: 'success',
          data: { status: 'success', videoUrl: uploadResult.url, progress: 100 },
        });
      } catch (uploadError: any) {
        logError('[Video Task Status] 上传失败，返回原始 URL:', uploadError);
        return NextResponse.json({
          code: 1000,
          message: 'success',
          data: { status: 'success', videoUrl: taskData.results[0], progress: 100 },
        });
      }
    }

    if (taskData.status === 'failed') {
      return NextResponse.json({
        code: 1000,
        message: 'success',
        data: { status: 'failed', error: 'Video generation failed', progress: 0 },
      });
    }

    // pending / processing
    return NextResponse.json({
      code: 1000,
      message: 'success',
      data: { status: taskData.status, progress: taskData.progress ?? 0 },
    });
  } catch (error: any) {
    logError('[Video Task Status] 错误:', error);
    return NextResponse.json(
      { code: error.response?.status || 500, message: error.message || '查询失败' },
      { status: error.response?.status || 500 }
    );
  }
}
