import React from 'react';
import { AppProvider } from './store';
import { Sidebar } from './components/Sidebar';
import { AgentArena } from './components/AgentArena';
import { CommandConsole } from './components/CommandConsole';
import { TimelineRail } from './components/TimelineRail';

export default function App() {
  return (
    <AppProvider>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      `}</style>
      <div className="h-screen w-screen bg-[#0a0a0c] text-zinc-300 overflow-hidden flex flex-col font-sans selection:bg-purple-500/30">
        
        {/* Global Nav / Command Strip */}
        <header className="h-12 border-b border-white/5 bg-black/40 flex items-center px-4 justify-between z-50 shrink-0 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-white">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-purple-500">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="font-bold tracking-tight">Make Control</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 font-mono tracking-widest border border-purple-500/20">
                ALPHA v3
              </span>
            </div>
            
            <div className="h-4 w-px bg-white/10 mx-2" />
            
            <div className="flex gap-4 text-xs font-medium text-zinc-500">
              <span className="hover:text-zinc-200 cursor-pointer transition-colors text-zinc-200">Execution</span>
              <span className="hover:text-zinc-200 cursor-pointer transition-colors">Agents</span>
              <span className="hover:text-zinc-200 cursor-pointer transition-colors">Patterns</span>
              <span className="hover:text-zinc-200 cursor-pointer transition-colors">Telemetry</span>
            </div>
          </div>
          
          <div className="flex items-center gap-3 text-xs font-mono text-zinc-500">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded bg-zinc-900 border border-white/5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
              WS: CONNECTED
            </div>
            <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-purple-500 to-cyan-500 shadow-lg border border-white/20" />
          </div>
        </header>

        {/* Main Workspace */}
        <div className="flex-1 flex overflow-hidden">
          <Sidebar />
          <div className="flex-1 flex flex-col relative z-0">
            <AgentArena />
            <CommandConsole />
          </div>
          <TimelineRail />
        </div>
      </div>
    </AppProvider>
  );
}