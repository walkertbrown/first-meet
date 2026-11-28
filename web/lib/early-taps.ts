// A tap that lands before the page's script has run (The Playner, Nov 28: "keep the tap and send once
// ready; never shown disabled"). Buttons that need the page (the camera, the clipboard, sharing, the
// platform's own steps) carry data-early="<id>". Until the page runs, this inline script takes a tap on
// one: it holds the button at 85% (look 5.1's loading fill) and keeps the last one tapped. Once the page
// runs, <EarlyTaps /> taps that button again, so its own handler does what she asked. The browser still
// counts her tap for a few seconds, so the clipboard and sharing accept it.
export const EARLY_HELD = 'data-early-held';

export const earlyTapScript = `(function(){var d=document;d.addEventListener('click',function(e){if(window.__fmReady)return;var t=e.target,b=t&&t.closest?t.closest('[data-early]'):null;if(!b)return;e.preventDefault();e.stopPropagation();var o=d.querySelector('[${EARLY_HELD}]');if(o)o.removeAttribute('${EARLY_HELD}');b.setAttribute('${EARLY_HELD}','');window.__fmEarly=b.getAttribute('data-early');},true);})();`;

type EarlyWindow = Window & { __fmReady?: boolean; __fmEarly?: string };

/** Called once the page runs: from now on taps go straight to the page; a held tap is tapped again. */
export function replayEarlyTap(w: EarlyWindow = window as EarlyWindow): string | null {
  w.__fmReady = true;
  const id = w.__fmEarly ?? null;
  delete w.__fmEarly;
  const held = w.document.querySelector(`[${EARLY_HELD}]`);
  held?.removeAttribute(EARLY_HELD);
  if (!id) return null;
  const el = w.document.querySelector<HTMLElement>(`[data-early="${id}"]`);
  el?.click();
  return el ? id : null;
}
