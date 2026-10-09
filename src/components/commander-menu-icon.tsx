import { CheckSquare, ClipboardList, CopyCheck, FileCheck, Filter, FolderTree, HardDrive, Info, List, LogOut, Network, Printer, Scissors, Share2, SortAsc, Star, Sun, Moon, Tags, Timer, Unplug } from 'lucide-react';
import { CommanderIcon, type CommanderIconName } from './commander-icons';
export function CommanderMenuIcon({ text }: { text: string }) {
  const colored: [RegExp, CommanderIconName][] = [[/Unpack/, 'unpack'], [/Pack|Archive/, 'pack'], [/Multi-Rename|Rename\/Move|^Move$/, 'rename'], [/Reread/, 'refresh'], [/Synchronize|Source ↔ Target|Target = Source|Compare Directories/, 'sync'], [/Copy/, 'copy'], [/Delete/, 'delete'], [/New Folder/, 'new-folder'], [/Edit|Comment/, 'edit'], [/Search/, 'search'], [/Quick View|^View$/, 'view'], [/Options|Configuration|Attributes/, 'settings'], [/Go Back/, 'back'], [/Terminal/, 'terminal'], [/Thumbnail/, 'image']];
  const match = colored.find(([pattern]) => pattern.test(text));
  if (match) return <CommanderIcon name={match[1]} />;
  const icons: [RegExp, typeof Info][] = [[/Checksum|Verify/, FileCheck], [/Properties|Information|About/, Info], [/Occupied|^Size$|Volume|Pools|Drive/, HardDrive], [/Print/, Printer], [/Split/, Scissors], [/Combine/, CopyCheck], [/Selection|Select|Mark/, CheckSquare], [/Clipboard/, ClipboardList], [/Hotlist/, Star], [/Tree|Branch|Folder Tabs/, FolderTree], [/Disconnect/, Unplug], [/Share/, Share2], [/FTP|SMB|NFS|Network/, Network], [/Custom|Programs|All Files|\*\.\*/, Filter], [/Extension|Name|Time|Unsorted|Reversed/, SortAsc], [/Background/, Timer], [/Light/, Sun], [/Dark/, Moon], [/Quit|Sign out/, LogOut], [/Full|Brief|Columns|Arrangement|View Modes/, List], [/Label/, Tags]];
  const Icon = icons.find(([pattern]) => pattern.test(text))?.[1];
  return Icon ? <Icon className="menu-symbol" aria-hidden="true" /> : null;
}
