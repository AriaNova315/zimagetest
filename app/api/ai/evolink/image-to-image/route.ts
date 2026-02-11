import { NextRequest, NextResponse } from 'next/server';
import { evolinkAxios } from '@/lib/axios-config';
import { log, logError } from '@/lib/logger';
import { auth } from '@/auth';
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
    log('[Evolink I2I] 用户 credit 余额:', { userUuid, balance });
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
    if (!prompt?.trim()) {
      return NextResponse.json({ code: 400, message: 'Missing prompt' }, { status: 400 });
    }

    log('[Evolink I2I] 收到请求:', {
      user: session.user.email,
      fileName: imageFile.name,
      fileSize: imageFile.size,
      prompt,
      aspectRatio,
    });

    // 上传参考图片到 R2，获取可访问 URL
    const storage = newStorage();
    const arrayBuffer = await imageFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const ext = imageFile.name.split('.').pop() || 'png';
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const key = `uploads/i2i/${year}/${month}/${day}/${now.getTime()}-${Math.random().toString(36).substring(2, 10)}.${ext}`;

    log('[Evolink I2I] 上传参考图片到 R2:', key);
    const uploadResult = await storage.uploadFile({
      body: buffer,
      key,
      contentType: imageFile.type || `image/${ext}`,
      disposition: 'inline',
    });
    log('[Evolink I2I] 参考图片 R2 URL:', uploadResult.url);

    // 调用 Evolink 图生图（和文生图同一个接口，加 image_urls 参数）
    const requestBody: Record<string, any> = {
      model: 'nano-banana-2-lite',
      prompt,
      image_urls: [uploadResult.url],
      quality: '2K',
    };
    if (aspectRatio) {
      requestBody.size = aspectRatio;
    }

    log('[Evolink I2I] 调用 Evolink API:', requestBody);
    const response = await evolinkAxios.post('/v1/images/generations', requestBody);
    log('[Evolink I2I] 任务创建响应:', response.data);

    // 扣减 credit
    await updateUserCredits(userUuid, -1, 'consume', '图生图');
    log('[Evolink I2I] 已扣减 1 个 credit，用户:', userUuid);

    return NextResponse.json({
      code: 1000,
      message: 'success',
      data: response.data,
    });
  } catch (error: any) {
    logError('[Evolink I2I] 错误:', error);
    const errorData = error.response?.data?.error || {};
    return NextResponse.json(
      {
        code: error.response?.status || 500,
        message: errorData.message || error.message || '生成失败',
        error: errorData,
      },
      { status: error.response?.status || 500 }
    );
  }
}
