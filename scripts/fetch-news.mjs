// 공개 RSS의 제목·요약·링크·발행 시각만 모아 news.json으로 저장합니다.
// GitHub Actions에서 매시간 실행됩니다. 외부 패키지 없이 Node 20+ 내장 fetch만 사용합니다.
import { writeFile } from 'node:fs/promises';

const FEEDS = [
  { name: '구글 뉴스', url: 'https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko', agg: true, w: 3 },
  { name: '연합뉴스', url: 'https://www.yna.co.kr/rss/news.xml', w: 2 },
  { name: 'BBC 코리아', url: 'https://feeds.bbci.co.uk/korean/rss.xml', w: 1 },
  { name: '한겨레', url: 'https://www.hani.co.kr/rss/', w: 1 },
  { name: '경향신문', url: 'https://www.khan.co.kr/rss/rssdata/total_news.xml', w: 1 },
  { name: '동아일보', url: 'https://rss.donga.com/total.xml', w: 1 },
  { name: '조선일보', url: 'https://www.chosun.com/arc/outboundfeeds/rss/?outputType=xml', w: 1 },
  { name: '매일경제', url: 'https://www.mk.co.kr/rss/30000001/', w: 1 }
];
const OUT = process.argv[2] || 'news.json';

function decode(buf, ct) {
  let enc = (ct?.match(/charset=([\w-]+)/i) || [])[1];
  const head = new TextDecoder('latin1').decode(buf.slice(0, 300));
  const m = head.match(/encoding=["']([\w-]+)["']/i);
  if (m) enc = m[1];
  try { return new TextDecoder(enc || 'utf-8').decode(buf); }
  catch { return new TextDecoder('utf-8').decode(buf); }
}
function entities(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, '&').trim();
}
function tag(block, names) {
  for (const n of names) {
    const m = block.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i'));
    if (m && m[1].trim()) return entities(m[1]);
  }
  return '';
}
function parse(xml, feed) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.slice(0, 60).map((b, i) => {
    let link = tag(b, ['link']);
    if (!link) link = (b.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] || '';
    return {
      title: tag(b, ['title']), link: entities(link),
      date: tag(b, ['pubDate', 'dc:date', 'published', 'updated']),
      desc: tag(b, ['description', 'summary']).slice(0, 600),
      source: tag(b, ['source']), feed: feed.name, agg: !!feed.agg, w: feed.w, rank: i
    };
  }).filter(it => it.title && /^https?:\/\//.test(it.link));
}
async function load(feed) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(feed.url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (bedtime-news RSS reader)' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const items = parse(decode(await r.arrayBuffer(), r.headers.get('content-type')), feed);
    if (!items.length) throw new Error('no items');
    return items;
  } finally { clearTimeout(t); }
}

const results = await Promise.allSettled(FEEDS.map(load));
const items = [], feeds = [];
results.forEach((r, i) => {
  if (r.status === 'fulfilled') { items.push(...r.value); feeds.push(FEEDS[i].name); console.log('ok  ', FEEDS[i].name, r.value.length); }
  else console.log('fail', FEEDS[i].name, r.reason?.message);
});
if (!items.length) { console.error('모든 피드 수집 실패'); process.exit(1); }
await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), feeds, items }));
console.log(`saved ${items.length} items from ${feeds.length} feeds → ${OUT}`);
