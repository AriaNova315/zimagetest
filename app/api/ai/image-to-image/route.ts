import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { evolinkAxios } from '@/lib/axios-config';
import { log, logError } from '@/lib/logger';
import { newStorage } from '@/lib/storage';
import { getUserCredits, updateUserCredits } from '@/models/credit';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 });
    }

    const userUuid = (session.user as any).uuid;

    // 检查 credit 余额
    const credits = await getUserCredits(userUuid);
    const balance = credits?.balance ?? 0;
    log('[ImageToImage] 用户 credit 余额:', { userUuid, balance });
    if (balance < 1) {
      return NextResponse.json({ code: 402, message: 'Insufficient credits' }, { status: 402 });
    }

    const formData = await request.formData();
    const imageFile = formData.get('image') as File | null;
    const prompt = formData.get('prompt') as string;
    const aspectRatio = formData.get('aspectRatio') as string | null;

    if (!imageFile) {
      return NextResponse.json({ code: 400, message: 'Missing image' }, { status: 400 });
    }
    if (!prompt) {
      return NextResponse.json({ code: 400, message: 'Missing prompt' }, { status: 400 });
    }

    log('[ImageToImage] 收到请求:', {
      user: session.user.email,
      fileName: imageFile.name,
      fileSize: imageFile.size,
      prompt,
      aspectRatio,
    });

    // 上传参考图片到 R2
    const storage = newStorage();
    const arrayBuffer = await imageFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const ext = imageFile.name.split('.').pop() || 'png';
    const now = new Date();
    const key = `uploads/i2i/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getTime()}-${Math.random().toString(36).substring(2, 10)}.${ext}`;

    log('[ImageToImage] 上传参考图片到 R2:', key);
    const uploadResult = await storage.uploadFile({
      body: buffer,
      key,
      contentType: imageFile.type || `image/${ext}`,
      disposition: 'inline',
    });
    const imageUrl = uploadResult.url;
    log('[ImageToImage] 参考图片 R2 URL:', imageUrl);

    // 调用 Evolink 图生图
    const requestBody: Record<string, any> = {
      model: 'nano-banana-2-lite',
      prompt,
      image_urls: [imageUrl],
    };
    if (aspectRatio) {
      requestBody.size = aspectRatio;
    }

    log('[ImageToImage] 调用 Evolink API:', requestBody);
    const taskResponse = await evolinkAxios.post('/v1/images/generations', requestBody);
    const taskId = taskResponse.data?.id;
    log('[ImageToImage] 任务已创建，taskId:', taskId);

    if (!taskId) {
      return NextResponse.json({ code: 500, message: '任务创建失败' }, { status: 500 });
    }

    // 轮询任务状态
    const maxAttempts = 120;
    const pollInterval = 2000;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const statusResponse = await evolinkAxios.get(`/v1/tasks/${taskId}`);
      const taskData = statusResponse.data;
      log('[ImageToImage] 任务状态:', { attempt, status: taskData.status, progress: taskData.progress });

      if (taskData.status === 'completed' && taskData.results?.length > 0) {
        // 上传结果图片到 R2
        const resultNow = new Date();
        const resultKey = `ai-generated/images/${resultNow.getFullYear()}/${String(resultNow.getMonth() + 1).padStart(2, '0')}/${String(resultNow.getDate()).padStart(2, '0')}/${resultNow.getTime()}-${Math.random().toString(36).substring(2, 10)}.png`;
        const r2Result = await storage.downloadAndUpload({
          url: taskData.results[0],
          key: resultKey,
          contentType: 'image/png',
          disposition: 'inline',
        });

        // 扣减 credit
        await updateUserCredits(userUuid, -1, 'consume', '图生图');
        log('[ImageToImage] 已扣减 1 个 credit，用户:', userUuid);

        return NextResponse.json({
          code: 1000,
          message: 'success',
          data: { images: [r2Result.url] },
        });
      }

      if (taskData.status === 'failed') {
        logError('[ImageToImage] 任务失败:', taskData);
        return NextResponse.json({ code: 500, message: '生成失败' }, { status: 500 });
      }
    }

    return NextResponse.json({ code: 500, message: '任务超时' }, { status: 500 });
  } catch (error: any) {
    logError('[ImageToImage] 错误:', error);
    const errorData = error.response?.data?.error || {};
    return NextResponse.json(
      {
        code: error.response?.status || 500,
        message: errorData.message || error.message || '生成失败',
      },
      { status: error.response?.status || 500 }
    );
  }
}
