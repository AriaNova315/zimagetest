import { NextResponse } from 'next/server';

const VIDEO_MODELS = [
  {
    id: 'veo3.1-fast',
    name: 'Veo 3.1 Fast',
    description: 'Google Veo 3.1 Fast - High quality video generation with text-to-video and image-to-video support',
    maxDuration: 8,
    supportedResolutions: ['720p', '1080p'],
    supportedAspectRatios: ['16:9', '9:16', 'auto'],
    supportedAspectDuration: [],
  },
];

export async function GET() {
  return NextResponse.json({ code: 1000, message: 'success', data: VIDEO_MODELS });
}
