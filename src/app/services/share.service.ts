import { Injectable, inject } from '@angular/core';
import { TranslationService } from './translation.service';
import { APP_DOWNLOAD_URL } from '../config';

@Injectable({ providedIn: 'root' })
export class ShareService {
  private readonly tr = inject(TranslationService);

  async generatePrImage(exerciseName: string, weight: number, unit: string, dateISO: string): Promise<Blob> {
    const W = 1080;
    const H = 1080;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');

    // Background
    ctx.fillStyle = '#08090a';
    ctx.fillRect(0, 0, W, H);

    // Lime accent bars top & bottom
    ctx.fillStyle = '#c4f542';
    ctx.fillRect(0, 0, W, 10);
    ctx.fillRect(0, H - 10, W, 10);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // Trophy emoji
    ctx.font = '110px serif';
    ctx.fillText('🏆', W / 2, 185);

    // "PERSONAL RECORD" label
    ctx.fillStyle = '#c4f542';
    ctx.font = 'bold 40px system-ui, -apple-system, sans-serif';
    ctx.fillText('PERSONAL RECORD', W / 2, 268);

    // Exercise name (white, wrapped up to 2 lines)
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 62px system-ui, -apple-system, sans-serif';
    this.drawWrappedText(ctx, exerciseName, W / 2, 372, W - 140, 74);

    // Weight (large monospace, lime)
    ctx.fillStyle = '#c4f542';
    ctx.font = 'bold 112px "Courier New", "Lucida Console", monospace';
    ctx.fillText(String(weight), W / 2, 588);

    // Unit
    ctx.fillStyle = '#c4f542';
    ctx.font = 'bold 38px system-ui, -apple-system, sans-serif';
    ctx.fillText(unit, W / 2, 644);

    // Date
    const [y, m, d] = dateISO.split('-');
    ctx.fillStyle = '#666666';
    ctx.font = '30px system-ui, -apple-system, sans-serif';
    ctx.fillText(`${d}/${m}/${y}`, W / 2, 714);

    // Separator
    ctx.strokeStyle = '#1e1f21';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(100, 756);
    ctx.lineTo(W - 100, 756);
    ctx.stroke();

    // App brand
    ctx.fillStyle = '#c4f542';
    ctx.font = 'bold 40px system-ui, -apple-system, sans-serif';
    ctx.fillText('GainAI', W / 2, 836);

    // Download CTA
    ctx.fillStyle = '#555555';
    ctx.font = '26px system-ui, -apple-system, sans-serif';
    ctx.fillText(APP_DOWNLOAD_URL, W / 2, 882);

    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
    );
  }

  private drawWrappedText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    startY: number,
    maxWidth: number,
    lineHeight: number,
  ): void {
    const words = text.split(' ');
    let line = '';
    let y = startY;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, y);
        line = word;
        y += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, y);
  }

  async share(exerciseName: string, weight: number, unit: string, dateISO: string): Promise<void> {
    const T = this.tr.T();
    const shareText = this.tr.tp('pr_share_text', {
      exercise: exerciseName,
      weight: String(weight),
      unit,
      url: APP_DOWNLOAD_URL,
    });

    let blob: Blob | null = null;
    try {
      blob = await this.generatePrImage(exerciseName, weight, unit, dateISO);
    } catch {
      // Canvas unavailable — proceed without image
    }

    if (blob) {
      const file = new File([blob], 'pr-gainai.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text: shareText, title: 'GainAI — Personal Record' });
          return;
        } catch (e) {
          if ((e as DOMException)?.name === 'AbortError') return;
        }
      }
    }

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: shareText, title: 'GainAI — Personal Record' });
        return;
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return;
      }
    }

    // Fallback: download image + copy link to clipboard
    if (blob) this.downloadBlob(blob);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(APP_DOWNLOAD_URL);
    }
    alert(T.pr_share_fallback_msg);
  }

  private downloadBlob(blob: Blob): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pr-gainai.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
