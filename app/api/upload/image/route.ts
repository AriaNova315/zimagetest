import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { newStorage } from '@/lib/storage';
import { log, logError } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session || !session.user) {
      return NextResponse.json({ code: 401, message: '未登录' }, { status: 401 });
    }

    const formData = await request.formData();
    const imageFile = formData.get('image') as File | null;

    if (!imageFile) {
      return NextResponse.json({ code: 400, message: 'Missing image' }, { status: 400 });
    }

    const arrayBuffer = await imageFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const ext = imageFile.name.split('.').pop() || 'png';
    const now = new Date();
    const key = `uploads/i2v/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${now.getTime()}-${Math.random().toString(36).substring(2, 10)}.${ext}`;

    log('[Upload Image] 上传图片到 R2:', key);
    const storage = newStorage();
    const result = await storage.uploadFile({
      body: buffer,
      key,
      contentType: imageFile.type || `image/${ext}`,
      disposition: 'inline',
    });

    log('[Upload Image] 上传成功:', result.url);
    return NextResponse.json({ code: 1000, message: 'success', data: { url: result.url } });
  } catch (error: any) {
    logError('[Upload Image] 错误:', error);
    return NextResponse.json(
      { code: 500, message: error.message || '上传失败' },
      { status: 500 }
    );
  }
}
