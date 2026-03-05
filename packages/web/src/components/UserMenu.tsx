import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Settings, Settings2, LogOut, ChevronUp, ChevronDown } from 'lucide-react';

interface UserMenuProps {
  user: { name?: string; email?: string; role?: string } | null;
  isSidebarOpen: boolean;
  logout: () => void;
  setMobileNavOpen: (open: boolean) => void;
}

export function UserMenu({ user, isSidebarOpen, logout, setMobileNavOpen }: UserMenuProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Position the portal dropdown relative to the avatar button
  useEffect(() => {
    if (profileOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      // Position it exactly aligned with the top of the button, and offset to the right
      setMenuPosition({
        top: rect.top - 120, // Approximate height of the menu to float above
        left: rect.left,
      });
    }
  }, [profileOpen, isSidebarOpen]);

  // Close the portal when clicking outside or scrolling
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (profileOpen && buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        // Find the portal root
        const popup = document.getElementById('user-menu-portal');
        if (popup && popup.contains(event.target as Node)) {
          return;
        }
        setProfileOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    // Optional: Hide on scroll so the fixed portal doesn't rip away from the moving button
    window.addEventListener('scroll', () => setProfileOpen(false), true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', () => setProfileOpen(false), true);
    };
  }, [profileOpen]);

  return (
    <div className={`pt-2 mt-2 border-t border-white/5 relative bg-black/20 ${isSidebarOpen ? 'px-2' : 'flex justify-center'}`}>
      <button 
        ref={buttonRef}
        onClick={() => setProfileOpen(!profileOpen)}
        className={`flex items-center rounded-md hover:bg-white/5 transition-colors group ${isSidebarOpen ? 'w-full gap-2 py-1.5' : 'p-1'}`}
        title={user?.email || 'User Profile'}
      >
        <div className="w-8 h-8 rounded-md bg-cyan-950/50 border border-cyan-500/20 flex items-center justify-center shrink-0 group-hover:bg-cyan-900/50 transition-colors">
          <span className="text-sm font-mono font-bold text-cyan-500 uppercase">
            {user?.name?.charAt(0) || user?.email?.charAt(0) || 'U'}
          </span>
        </div>
        <div className={`flex-1 min-w-0 text-left transition-opacity duration-300 ${!isSidebarOpen && 'hidden lg:block lg:opacity-0 lg:w-0 lg:overflow-hidden'}`}>
          <p className="text-[13px] font-medium text-gray-200 truncate whitespace-nowrap">{user?.name || user?.email || 'User'}</p>
          <p className="text-[10px] font-mono text-cyan-400 truncate whitespace-nowrap capitalize">{user?.role || 'user'}</p>
        </div>
        {isSidebarOpen && (
          profileOpen ? <ChevronUp className="w-3 h-3 text-gray-500 shrink-0" /> : <ChevronDown className="w-3 h-3 text-gray-500 shrink-0" />
        )}
      </button>

      {/* Dropdown Menu Portal */}
      {profileOpen && menuPosition && (
        createPortal(
          <div
            id="user-menu-portal"
            style={{ 
              top: menuPosition.top, 
              left: isSidebarOpen ? menuPosition.left : menuPosition.left + 50 
            }}
            className="fixed w-[220px] mb-1 bg-zinc-900 border border-white/10 rounded-lg shadow-xl overflow-hidden shadow-[0_-5px_20px_rgba(0,0,0,0.5)] z-[100] animate-in slide-in-from-bottom-2 duration-150"
          >
            <div className="px-3 py-2 border-b border-white/5">
              <p className="text-xs font-medium text-white truncate">{user?.email}</p>
            </div>
            <Link
              to="/settings"
              onClick={() => { setProfileOpen(false); setMobileNavOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              Settings
            </Link>
            {user?.role === 'admin' && (
              <Link
                to="/admin"
                onClick={() => { setProfileOpen(false); setMobileNavOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-amber-400 hover:bg-amber-950/30 hover:text-amber-300 transition-colors"
              >
                <Settings2 className="w-3.5 h-3.5" />
                Admin Panel
              </Link>
            )}
            <div className="border-t border-white/5" />
            <button
              onClick={() => {
                logout();
                setProfileOpen(false);
                setMobileNavOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose-400 hover:bg-rose-950/30 hover:text-rose-300 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Log Out
            </button>
          </div>,
          document.body
        )
      )}
    </div>
  );
}
