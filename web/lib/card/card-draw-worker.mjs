// The card PNG drawer's thread (see card-draw.ts): Satori and resvg, which block whatever thread they run on.
// It gets the card fonts once, then a plain element tree and a size per message, and answers with the PNG.
import { parentPort, workerData } from 'node:worker_threads';

const { ImageResponse } = await import('next/dist/compiled/@vercel/og/index.node.js');

parentPort.on('message', async ({ id, tree, size }) => {
  try {
    const png = await new ImageResponse(tree, { ...size, fonts: workerData.fonts }).arrayBuffer();
    parentPort.postMessage({ id, png }, [png]);
  } catch (e) {
    parentPort.postMessage({ id, error: String(e?.stack ?? e) });
  }
});
