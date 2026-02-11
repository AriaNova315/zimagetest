import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { evolinkAxios } from '@/lib/axios-config';
import { log, logError } from '@/lib/logger';
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
    log('[Video Create] 用户 credit 余额:', { userUuid, balance });
    if (balance < 4) {
      return NextResponse.json({ code: 402, message: 'Insufficient credits' }, { status: 402 });
    }

    const body = await request.json();
    const { prompt, resolution, aspectRatio, imageUrl } = body;

    log('[Video Create] 收到请求:', {
      user: session.user.email,
      prompt,
      resolution,
      aspectRatio,
      hasImageUrl: !!imageUrl,
    });

    const requestBody: Record<string, any> = {
      model: 'veo3.1-fast',
      prompt,
    };

    if (aspectRatio && aspectRatio !== 'auto') {
      requestBody.aspect_ratio = aspectRatio;
    }

    if (resolution) {
      requestBody.quality = resolution; // 720p / 1080p
    }

    if (imageUrl) {
      requestBody.image_urls = [imageUrl];
      requestBody.generation_type = 'FIRST&LAST';
    } else {
      requestBody.generation_type = 'TEXT';
    }

    log('[Video Create] 调用 Evolink API:', requestBody);
    const response = await evolinkAxios.post('/v1/videos/generations', requestBody);
    const taskId = response.data?.id;
    log('[Video Create] 任务已创建，taskId:', taskId);

    // 扣减 credit
    await updateUserCredits(userUuid, -4, 'consume', '生成视频');
    log('[Video Create] 已扣减 4 个 credit，用户:', userUuid);

    return NextResponse.json({
      code: 1000,
      message: 'success',
      data: { taskId },
    });
  } catch (error: any) {
    logError('[Video Create] 错误:', error);
    const errorData = error.response?.data?.error || {};
    return NextResponse.json(
      {
        code: error.response?.status || 500,
        message: errorData.message || error.message || '视频生成失败',
        error: errorData,
      },
      { status: error.response?.status || 500 }
    );
  }
}
