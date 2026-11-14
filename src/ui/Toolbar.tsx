import { useState } from 'react';
import {
  MousePointer2, Eraser, Minus, Grid3X3,
  Tag, ChevronUp, ChevronDown, Trash2, Printer,
  Save, FolderOpen, HelpCircle,
} from 'lucide-react';
import { useStore } from '../store';
import { usePrefs, type WallLabelMode } from '../prefs';
import { Tool, AUTOSAVE_KEY } from '../constants';

function saveToFile(data: string) {
  localStorage.setItem(AUTOSAVE_KEY, data);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'floor-plan.arcada'; a.click();
  URL.revokeObjectURL(url);
}

function loadFromFile(onLoad: (json: string) => void) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json,.arcada';
  input.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.item(0);
    if (file) onLoad(await file.text());
  };
  input.click();
}

export function Toolbar() {
  const { tool, setTool, snapSize, setSnapSize, fi, changeFloor, removeFloor, save, load, markSaved } = useStore();
  const wallLabels = usePrefs(s => s.wallLabels);
  const setPref = usePrefs(s => s.set);

  const loadProject = (json: string) => {
    if (useStore.getState().dirty && !confirm('You have unsaved changes. Open another project anyway?')) return;
    try {
      load(json);
    } catch (err) {
      alert('Could not open the file: ' + (err instanceof Error ? err.message : String(err)));
    }
  };
  const [showHelp, setShowHelp] = useState(false);

  const toolBtn = (icon: React.ReactNode, label: string, t: Tool) => (
    <button
      key={label}
      title={label}
      className={'tool-btn' + (tool === t ? ' active' : '')}
      onClick={() => setTool(t)}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  const toggleBtn = (icon: React.ReactNode, label: string, active: boolean, onClick: () => void) => (
    <button
      key={label}
      title={label}
      className={'tool-btn' + (active ? ' active' : '')}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );

  const actionBtn = (icon: React.ReactNode, label: string, onClick: () => void) => (
    <button key={label} title={label} className="tool-btn" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );

  return (
    <>
      <nav className="toolbar">
        <div className="toolbar-logo">A</div>

        <div className="tool-group">
          {toolBtn(<MousePointer2 size={20} />, 'Select', Tool.Select)}
          {toolBtn(<Minus size={20} />,         'Wall',   Tool.WallAdd)}
          {toolBtn(<Eraser size={20} />,        'Erase',  Tool.Remove)}
        </div>

        <div className="tool-group">
          <div className="floor-controls">
            <button className="floor-arrow" title="Floor up"   onClick={() => changeFloor(1)}><ChevronUp size={14} /></button>
            <span className="floor-num">{fi}</span>
            <button className="floor-arrow" title="Floor down" onClick={() => changeFloor(-1)}><ChevronDown size={14} /></button>
            <button className="floor-arrow floor-del" title="Delete floor" onClick={() => { if (!removeFloor()) alert('Cannot delete the only floor.'); }}>
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        <div className="tool-group">
          <div className={'snap-btn-wrap' + (snapSize > 0 ? ' active' : '')}>
            <Grid3X3 size={20} />
            <span className="snap-label">Snap</span>
            <select
              className="snap-select"
              value={snapSize}
              onChange={e => setSnapSize(+e.target.value)}
            >
              <option value={0}>Off</option>
              <option value={5}>5 cm</option>
              <option value={10}>10 cm</option>
              <option value={25}>25 cm</option>
              <option value={50}>50 cm</option>
            </select>
          </div>
          <div className={'snap-btn-wrap' + (wallLabels !== 'off' ? ' active' : '')} title="Wall lengths">
            <Tag size={20} />
            <span className="snap-label">Lengths</span>
            <select
              className="snap-select"
              value={wallLabels}
              onChange={e => setPref('wallLabels', e.target.value as WallLabelMode)}
            >
              <option value="off">Off</option>
              <option value="interior">Inside</option>
              <option value="both">Both</option>
              <option value="axis">Axis</option>
            </select>
          </div>
        </div>

        <div className="tool-group toolbar-bottom">
          {actionBtn(<Save size={20} />,       'Save',  () => { saveToFile(save()); markSaved(); })}
          {actionBtn(<FolderOpen size={20} />, 'Load',  () => loadFromFile(loadProject))}
          {actionBtn(<Printer size={20} />,    'Print', () => window.print())}
          {actionBtn(<HelpCircle size={20} />, 'Help',  () => setShowHelp(true))}
        </div>
      </nav>

      {showHelp && (
        <div className="help-overlay" onClick={() => setShowHelp(false)}>
          <div className="help-box" onClick={e => e.stopPropagation()}>
            <h3>Quick help</h3>
            <ul>
              <li><b>Select tool:</b> Click furniture to select, drag to move, drag handles to resize/rotate. Drag wall nodes to reshape.</li>
              <li><b>Draw wall:</b> Wall tool → click to place nodes → click a node again to end</li>
              <li><b>Split wall:</b> Wall tool → click on an existing wall</li>
              <li><b>Toggle exterior:</b> Right-click on wall</li>
              <li><b>Pan:</b> Right-click drag</li>
              <li><b>Zoom:</b> Scroll wheel</li>
              <li><b>Snap:</b> Configurable grid snap (Off / 5 / 10 / 25 / 50 cm)</li>
              <li><b>Escape:</b> Return to Select tool</li>
              <li><b>Ctrl+S:</b> Quick save</li>
              <li><b>Ctrl+Z / Ctrl+Shift+Z:</b> Undo / Redo</li>
              <li><b>Ctrl+C / Ctrl+V / Ctrl+X:</b> Copy / Paste / Cut</li>
              <li><b>Delete:</b> Remove selected furniture</li>
            </ul>
            <button onClick={() => setShowHelp(false)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
