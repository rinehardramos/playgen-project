import './globals.css';
import ClientLayout from '@/components/ClientLayout';

export const metadata = {
  title: 'PlayGen — AI Radio Station Manager',
  description: 'AI-powered radio automation and scheduling',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="bg-[#0b0b10] text-white min-h-screen">
        <ClientLayout>
          {children}
        </ClientLayout>
      </body>
    </html>
  );
}
