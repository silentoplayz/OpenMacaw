import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Forbidden() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center bg-black">
      <div className="w-20 h-20 rounded-full bg-rose-500/10 flex items-center justify-center mb-6 border border-rose-500/20 shadow-[0_0_30px_rgba(244,63,94,0.1)]">
        <ShieldAlert className="w-10 h-10 text-rose-500" />
      </div>
      
      <h1 className="text-3xl font-bold text-white tracking-tight mb-3 uppercase font-mono">Access Denied</h1>
      <p className="text-gray-400 max-w-md mx-auto mb-8 leading-relaxed font-mono text-sm">
        SECURITY_PROTOCOL_403: Insufficient administrative clearance for this node. 
        Please contact your system administrator.
      </p>

      <Link
        to="/chat"
        className="flex items-center gap-2 px-6 py-3 bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-white rounded-xl transition-all shadow-xl hover:shadow-cyan-500/10 group"
      >
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
        Return to Chat
      </Link>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-[10px] font-mono text-gray-700 uppercase tracking-[0.2em]">
        OpenMacaw :: Security Protocol 403
      </div>
    </div>
  );
}
