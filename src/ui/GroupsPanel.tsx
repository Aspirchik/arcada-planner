/** Cable groups (Wiring mode): local to this floor or common to all floors; each can be highlighted */
import { useEffect, useState } from 'react';
import { Lightbulb, LightbulbOff, Trash2, Plus, X } from 'lucide-react';
import { useStore } from '../store';
import { useT } from '../i18n';
import type { CableGroup } from '../types';

/** Group name that saves on Enter / blur */
function NameField({ group }: { group: CableGroup }) {
  const [text, setText] = useState(group.name);
  useEffect(() => setText(group.name), [group.name]);
  const commit = () => {
    const v = text.trim();
    if (v && v !== group.name) useStore.getState().renameGroup(group.id, v);
    else setText(group.name);
  };
  return (
    <input type="text" className="grp-name" value={text} onChange={e => setText(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setText(group.name); e.currentTarget.blur(); } }} />
  );
}

export function GroupsPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const floor = useStore(s => s.floors[s.fi]);
  const common = useStore(s => s.commonGroups);
  const lit = useStore(s => s.litGroups);
  const st = useStore.getState();

  const count = (id: number) => floor.cables.filter(c => c.groups?.includes(id)).length;
  const nextName = () => t('groups.newName', { n: floor.groups.length + common.length + 1 });

  const section = (title: string, groups: CableGroup[], scope: 'local' | 'common') => (
    <div className="grp-section">
      <div className="grp-head">
        <span>{title}</span>
        <button className="sel-btn" title={t('groups.add')} onClick={() => st.addGroup(scope, nextName())}><Plus size={14} /></button>
      </div>
      {groups.length === 0 && <div className="grp-empty">{t('groups.empty')}</div>}
      {groups.map(g => {
        const on = lit.includes(g.id);
        return (
          <div key={g.id} className={'grp-row' + (on ? ' lit' : '')}>
            <button className={'sel-btn' + (on ? ' active' : '')} title={t('groups.highlight')} onClick={() => st.toggleLit(g.id)}>
              {on ? <Lightbulb size={14} /> : <LightbulbOff size={14} />}
            </button>
            <NameField group={g} />
            <span className="grp-count" title={t('groups.countTitle')}>{count(g.id)}</span>
            <button className="sel-btn" title={t('groups.delete')}
              onClick={() => { if (confirm(t('groups.deleteConfirm', { name: g.name }))) st.deleteGroup(g.id); }}><Trash2 size={14} /></button>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="groups-panel">
      <div className="grp-title">
        <b>{t('groups.title')}</b>
        <button className="sel-btn" title={t('help.close')} onClick={onClose}><X size={14} /></button>
      </div>
      {section(t('groups.local'), floor.groups, 'local')}
      {section(t('groups.common'), common, 'common')}
      <div className="grp-hint">{t('groups.hint')}</div>
    </div>
  );
}

/** Group chips in the cable panel: click to add the cable to a group or take it out */
export function CableGroupChips({ cableId, groups }: { cableId: number; groups?: number[] }) {
  const t = useT();
  const local = useStore(s => s.floors[s.fi].groups);
  const common = useStore(s => s.commonGroups);
  const all = [...local, ...common];
  if (all.length === 0) return <span className="grp-empty">{t('groups.noneYet')}</span>;
  return (
    <span className="grp-chips" title={t('cable.groups')}>
      {all.map(g => (
        <button key={g.id} className={'grp-chip' + (groups?.includes(g.id) ? ' active' : '') + (common.includes(g) ? ' common' : '')}
          onClick={() => useStore.getState().toggleCableGroup(cableId, g.id)}>{g.name}</button>
      ))}
    </span>
  );
}
