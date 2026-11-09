// A staging test close call for the checkers (plan 7, phase 2: "until the close-call sample is
// in, the check reaches the demo referee with a staging test attempt sent with its command times
// out of order, which is always a close call, command_times").
//
// How: on staging, start the demo meet at /demo (Barbell), then on /platform open the browser's
// console and paste this whole file. It makes a fresh first attempt ("Lift it again"), uploads a
// real sample clip as that attempt, and sends "Rack!" before "Squat!", so the judge calls it a
// close call. It prints the demo referee's link; reload /platform to see the attempt waiting.
(async () => {
  if (!/staging/.test(location.host) && !/^(localhost|127\.0\.0\.1)/.test(location.host)) throw new Error('staging only');
  const post = async (url, body) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${url} ${r.status} ${j.error ?? ''}`);
    return j;
  };
  const { attempt } = await post('/api/demo/again');
  const clip = await (await fetch('/samples/good-lift-wabba.mp4')).blob();
  const { upload_id } = await post(`/api/attempts/${attempt.id}/upload`, { type: 'video/mp4' });
  const { urls } = await post(`/api/attempts/${attempt.id}/upload`, { upload_id, parts: [1] });
  const put = await fetch(urls[1] ?? urls['1'], { method: 'PUT', body: clip });
  if (!put.ok) throw new Error(`upload ${put.status}`);
  const etag = put.headers.get('etag') ?? '';
  // "Bar is loaded." at 0.5 s, "Squat!" at 2.5 s, "Rack!" at 1.5 s: out of order
  await post(`/api/attempts/${attempt.id}/uploaded`, { upload_id, parts: [{ part: 1, etag }], command_times: { loaded: 500, squat: 2500, rack: 1500 } });
  const link = `${location.origin}/referee/demo/${attempt.id}`;
  console.log(`Sent. In a minute or so it's a close call: ${link}`);
  return link;
})();
