export type CommanderIconName = 'refresh' | 'pack' | 'unpack' | 'view' | 'edit' | 'search' | 'rename' | 'sync' | 'terminal' | 'settings' | 'folder' | 'drive' | 'image' | 'video' | 'music' | 'archive' | 'code' | 'file' | 'app' | 'back' | 'forward' | 'copy' | 'delete' | 'new-folder' | 'details';

/** Browser-safe, scalable recreation of the colored Windows toolbar vocabulary. */
export function CommanderIcon({ name, className = '' }: { name: CommanderIconName; className?: string }) {
  const colors = { blue: 'var(--icon-blue)', green: 'var(--icon-green)', gold: 'var(--icon-gold)', red: 'var(--icon-red)', paper: 'var(--icon-paper)', line: 'var(--icon-line)' };
  const folder = <><path d="M2 7V4h8l3 3h9v14H2Z" fill={colors.gold} stroke={colors.line} strokeWidth=".7" /><path d="M2 10h20v11H2Z" fill="var(--icon-folder-front)" /></>;
  const page = <><path d="M5 2h10l5 5v15H5Z" fill={colors.paper} stroke={colors.line} strokeWidth=".8" /><path d="M15 2v5h5" fill="none" stroke={colors.line} strokeWidth=".8" /></>;
  const arrow = <path d="M7 13h9V9l6 6-6 6v-4H7Z" fill={colors.green} />;
  let drawing;
  switch (name) {
    case 'back': case 'forward': drawing = <path d={name === 'back' ? 'M3 12 12 3v6h10v6H12v6Z' : 'M21 12 12 3v6H2v6h10v6Z'} fill={colors.line} stroke={colors.paper} strokeWidth=".5" />; break;
    case 'copy': drawing = <><path d="M2 2h11v15H2Z" fill={colors.paper} stroke={colors.blue} strokeWidth=".8" /><path d="M9 7h11v15H9Z" fill={colors.paper} stroke={colors.blue} strokeWidth=".8" /><path d="M12 11h5m-5 3h5m-5 3h5" stroke={colors.blue} strokeWidth=".6" /></>; break;
    case 'delete': drawing = <>{page}<path d="m10 11 8 8m0-8-8 8" stroke={colors.red} strokeWidth="2" /></>; break;
    case 'new-folder': drawing = <>{folder}<path d="M17 1v10m-5-5h10" stroke={colors.blue} strokeWidth="2" /></>; break;
    case 'details': drawing = <><path d="M2 2h20v20H2Z" fill={colors.paper} stroke={colors.blue} strokeWidth=".8" /><path d="M8 3v18m6-18v18M3 8h18M3 13h18M3 18h18" stroke={colors.blue} strokeWidth=".7" /><path d="M3 3h4v4H3Z" fill={colors.gold} /></>; break;
    case 'refresh': drawing = <><path d="M20 7a9 9 0 0 0-15-1L2 9h7V2L6 5M4 17a9 9 0 0 0 15 1l3-3h-7v7l3-3" fill="none" stroke={colors.green} strokeWidth="2.4" /></>; break;
    case 'folder': drawing = folder; break;
    case 'pack': case 'unpack': case 'archive': drawing = <>{folder}<path d="M10 7h4v14h-4Z" fill={colors.gold} stroke={colors.line} strokeWidth=".6" /><path d="M11 8h2m-2 3h2m-2 3h2m-2 3h2" stroke={colors.line} strokeWidth="1.5" />{name !== 'archive' && <path d={name === 'pack' ? 'M18 1v6h-3l5 5 4-5h-3V1Z' : 'M18 11V5h-3l5-5 4 5h-3v6Z'} fill={colors.green} />}</>; break;
    case 'view': drawing = <>{page}<path d="M8 9h9M8 12h9M8 15h9M8 18h6" stroke={colors.blue} strokeWidth="1.6" /></>; break;
    case 'edit': drawing = <>{page}<path d="m8 17 10-12 4 3-10 12-5 1Z" fill={colors.gold} stroke={colors.line} strokeWidth=".7" /><path d="m18 5 2-2 4 3-2 2Z" fill={colors.red} /></>; break;
    case 'search': drawing = <><path d="M3 6h5l2 13H1ZM16 6h5l2 13h-9Z" fill={colors.blue} /><path d="M7 5V3h3v8h4V3h3v2M7 12h10" fill="none" stroke={colors.line} strokeWidth="2" /><circle cx="5" cy="18" r="4" fill={colors.line} /><circle cx="19" cy="18" r="4" fill={colors.line} /><circle cx="5" cy="18" r="2.5" fill={colors.paper} /><circle cx="19" cy="18" r="2.5" fill={colors.paper} /></>; break;
    case 'rename': drawing = <><path d="M2 3h9v6H2Zm0 12h9v6H2Z" fill={colors.paper} stroke={colors.blue} /><path d="M4 6h5M4 18h5" stroke={colors.blue} />{arrow}<path d="m17 3 4 4m-4 0 4-4" stroke={colors.red} strokeWidth="2" /></>; break;
    case 'sync': drawing = <><path d="M2 3h6v18H2Zm14 0h6v18h-6Z" fill={colors.gold} /><path d="M4 6h2m-2 4h2m-2 4h2m12-8h2m-2 4h2m-2 4h2" stroke={colors.line} /><path d="M9 7h5V4l4 5-4 5v-3H9Zm6 10h-5v3l-4-5 4-5v3h5Z" fill={colors.green} /></>; break;
    case 'terminal': drawing = <><rect x="2" y="3" width="20" height="18" rx="1" fill={colors.line} /><path d="m6 8 4 4-4 4m6 0h6" stroke={colors.paper} strokeWidth="1.8" fill="none" /><path d="M2 6h20" stroke={colors.blue} strokeWidth="2" /></>; break;
    case 'settings': drawing = <><path d="m9 2 1 3h4l1-3 3 2-1 3 2 2 3-1 1 4-3 1v3l2 2-3 3-3-2-3 1-1 3-4-1v-3l-3-2-3 1-1-4 3-1V9L2 7l3-3 3 2Z" fill={colors.blue} /><circle cx="12" cy="12" r="4" fill={colors.paper} stroke={colors.line} /></>; break;
    case 'drive': drawing = <><path d="M4 5h16l3 13H1Z" fill="var(--icon-drive)" stroke={colors.line} strokeWidth=".8" /><path d="M1 15h22v5H1Z" fill={colors.paper} stroke={colors.line} strokeWidth=".8" /><path d="M4 17h11" stroke={colors.line} /><circle cx="20" cy="17.5" r="1" fill={colors.green} /></>; break;
    case 'app': drawing = <><rect x="2" y="2" width="20" height="20" rx="2" fill={colors.blue} /><path d="M5 5h14v5H5Z" fill={colors.paper} /><path d="M6 14h12v8H6Z" fill={colors.red} /><path d="M8 16h8v6H8Z" fill={colors.paper} /></>; break;
    default: drawing = <>{page}{name === 'image' ? <><path d="m7 18 4-6 3 4 2-2 3 4Z" fill={colors.green} /><circle cx="9" cy="9" r="2" fill={colors.gold} /></> : name === 'video' ? <path d="m9 9 8 5-8 5Z" fill={colors.blue} /> : name === 'music' ? <path d="M10 17V9l7-2v8m-7-4 7-2M7 17h3v3H7Zm7-2h3v3h-3Z" fill={colors.red} stroke={colors.red} /> : name === 'code' ? <path d="m11 10-4 4 4 4m4-8 4 4-4 4" fill="none" stroke={colors.green} strokeWidth="1.5" /> : <path d="M8 10h9m-9 3h9m-9 3h9m-9 3h6" stroke={colors.blue} />}</>;
  }
  return <svg className={`commander-icon ${className}`} viewBox="0 0 24 24" aria-hidden="true">{drawing}</svg>;
}