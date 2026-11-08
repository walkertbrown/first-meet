import type { Metadata, Viewport } from 'next';
import './globals.css';
import './stage.css';
import './landing.css';
import './pages.css';

export const metadata: Metadata = {
  title: { default: 'First Meet', template: '%s · First Meet' },
  description:
    'Your first powerlifting meet, from home. Train for 12 weeks, then lift on meet weekend with your phone as the referee. Hosted by Love Soo.',
  metadataBase: new URL(process.env.APP_URL ?? 'https://first-meet-web.onrender.com'),
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F3F4F1' },
    { media: '(prefers-color-scheme: dark)', color: '#0E0F14' },
  ],
};

// Her theme choice (look 2): the system setting unless she picked Day or Lights down.
// ?theme=light|dark previews one without saving it.
const themeScript = `(function(){try{var q=new URLSearchParams(location.search).get('theme');var t=q==='light'||q==='dark'?q:localStorage.getItem('fm-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
