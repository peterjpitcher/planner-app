'use client';

import { Sidebar } from './Sidebar';
import { Header } from './Header';

export default function AppShell({ children }) {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <Sidebar />
      <Header />
      <main className="pl-[240px] pt-14 min-h-screen">
        <div className="w-full p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
