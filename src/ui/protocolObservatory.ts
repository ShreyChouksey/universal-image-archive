import {
  OPEN_PROTOCOL_DECISIONS,
  PROTOCOL_AREAS,
  PROTOCOL_EVIDENCE_POLICY,
  PROTOCOL_GATES,
  PROTOCOL_SOURCE_REVISION,
  PROTOCOL_STATUSES,
  PROTOCOL_WORK_ITEMS,
  type ProtocolStatus,
  type ProtocolWorkItem,
} from '../core/protocolProgress';

type ObservatoryView = 'map' | 'matrix' | 'decisions';

const byId = new Map(PROTOCOL_WORK_ITEMS.map((item) => [item.id, item]));
const areaById = new Map(PROTOCOL_AREAS.map((area) => [area.id, area]));

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function statusLabel(status: ProtocolStatus): string {
  return PROTOCOL_STATUSES.find((entry) => entry.id === status)?.label ?? status;
}

function dependencyPressure(): ReadonlyArray<{ item: ProtocolWorkItem; count: number }> {
  const counts = new Map<string, number>();
  for (const workItem of PROTOCOL_WORK_ITEMS) {
    for (const dependency of workItem.dependencies) {
      counts.set(dependency, (counts.get(dependency) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ item: byId.get(id), count }))
    .filter((entry): entry is { item: ProtocolWorkItem; count: number } => Boolean(entry.item))
    .filter((entry) => entry.item.status !== 'verified')
    .sort((a, b) => b.count - a.count || a.item.title.localeCompare(b.item.title));
}

export function mountProtocolObservatory(): void {
  const root = document.getElementById('protocolObservatory');
  const trigger = document.getElementById('protocolOpen') as HTMLButtonElement | null;
  if (!root || !trigger || root.dataset.mounted === 'true') return;
  root.dataset.mounted = 'true';

  root.innerHTML = `
    <div class="protocol-observatory__backdrop" data-protocol-close></div>
    <div class="protocol-observatory__surface" role="document">
      <header class="protocol-observatory__header">
        <div>
          <div class="protocol-observatory__eyebrow">UIA / Architecture & Protocol / Evidence Index</div>
          <h2 id="protocolObservatoryTitle">Protocol Observatory</h2>
          <p>No aggregate security score. Every system carries its own specification, implementation, verification, deployment, and risk state; every claim carries its own evidence and the boundary that evidence does not cross.</p>
        </div>
        <div class="protocol-observatory__header-actions">
          <span class="protocol-boundary">NOT PRODUCTION</span>
          <button class="ghost protocol-observatory__close" id="protocolClose" type="button">Close</button>
        </div>
      </header>

      <section class="protocol-summary" aria-label="Protocol status summary">
        <div class="protocol-summary__metric"><span class="label">Proposed planning gates</span><strong id="protocolGateSummary">0 / 11</strong><small>passed and current</small></div>
        <div class="protocol-summary__metric"><span class="label">Tracked obligations</span><strong id="protocolItemSummary">—</strong><small id="protocolAreaSummary">across — systems</small></div>
        <div class="protocol-summary__metric"><span class="label">Open decisions</span><strong id="protocolDecisionSummary">—</strong><small>explicit, not hidden</small></div>
        <div class="protocol-summary__metric"><span class="label">Current objective</span><strong>ADR-000</strong><small>protocol outcome & requirements</small></div>
        <div class="protocol-summary__breakthrough">
          <span class="label">Latest breakthrough</span>
          <p>The draft architecture now distinguishes RawTile3072, proposed BlockCommit512, and proposed VisualCommit3072. No commitment implementation is implied.</p>
        </div>
      </section>

      <div class="protocol-observatory__layout">
        <aside class="protocol-sidebar" aria-label="Protocol filters">
          <label class="label" for="protocolSearch">Find an obligation</label>
          <input id="protocolSearch" type="text" placeholder="finality, keys, availability…" autocomplete="off" />

          <div class="protocol-view-tabs" role="tablist" aria-label="Observatory view">
            <button id="protocolMapTab" type="button" role="tab" data-protocol-view="map" aria-controls="protocolMapView" aria-selected="true">Map</button>
            <button id="protocolMatrixTab" type="button" role="tab" data-protocol-view="matrix" aria-controls="protocolMatrixView" aria-selected="false" tabindex="-1">Matrix</button>
            <button id="protocolDecisionsTab" type="button" role="tab" data-protocol-view="decisions" aria-controls="protocolDecisionsView" aria-selected="false" tabindex="-1">Decisions</button>
          </div>

          <div class="protocol-sidebar__section">
            <span class="label">Systems</span>
            <div class="protocol-area-list" id="protocolAreaList"></div>
          </div>

          <div class="protocol-sidebar__section">
            <span class="label">Status</span>
            <div class="protocol-status-list" id="protocolStatusList"></div>
          </div>

          <button class="ghost protocol-reset" id="protocolReset" type="button">Reset filters</button>
          <p class="protocol-source" id="protocolSource"></p>
        </aside>

        <main class="protocol-workspace">
          <section class="protocol-gates" aria-labelledby="protocolGatesTitle">
            <div class="protocol-section-head">
              <div><span class="label">Non-normative planning model</span><h3 id="protocolGatesTitle">From guarantees toward launch</h3></div>
              <p>Stages summarize closure; cross-stage co-design and stale evidence are expected.</p>
            </div>
            <div class="protocol-gate-rail" id="protocolGateRail"></div>
          </section>

          <section class="protocol-insights" id="protocolInsights" aria-label="Critical path insight"></section>

          <section id="protocolMapView" role="tabpanel" aria-labelledby="protocolMapTab" data-protocol-panel="map">
            <div class="protocol-section-head protocol-section-head--work">
              <div><span class="label">Work map</span><h3 id="protocolWorkTitle">All tracked obligations</h3></div>
              <p id="protocolResultCount">—</p>
            </div>
            <div class="protocol-work-grid" id="protocolWorkGrid"></div>
          </section>

          <section id="protocolMatrixView" role="tabpanel" aria-labelledby="protocolMatrixTab" data-protocol-panel="matrix" hidden>
            <div class="protocol-section-head">
              <div><span class="label">Independent axes</span><h3>System readiness matrix</h3></div>
              <p>No averages. The weakest required axis remains visible.</p>
            </div>
            <div class="protocol-matrix" id="protocolMatrix"></div>
          </section>

          <section id="protocolDecisionsView" role="tabpanel" aria-labelledby="protocolDecisionsTab" data-protocol-panel="decisions" hidden>
            <div class="protocol-section-head">
              <div><span class="label">Decision register</span><h3>Questions implementation must not answer accidentally</h3></div>
              <p>Each requires an accepted ADR.</p>
            </div>
            <div class="protocol-decision-grid" id="protocolDecisionGrid"></div>
          </section>
        </main>

        <aside class="protocol-detail" aria-live="polite" aria-label="Selected protocol obligation">
          <div id="protocolDetail"></div>
        </aside>
      </div>
    </div>`;

  const search = root.querySelector<HTMLInputElement>('#protocolSearch')!;
  const areaList = root.querySelector<HTMLElement>('#protocolAreaList')!;
  const statusList = root.querySelector<HTMLElement>('#protocolStatusList')!;
  const gateRail = root.querySelector<HTMLElement>('#protocolGateRail')!;
  const insights = root.querySelector<HTMLElement>('#protocolInsights')!;
  const workGrid = root.querySelector<HTMLElement>('#protocolWorkGrid')!;
  const detail = root.querySelector<HTMLElement>('#protocolDetail')!;
  const matrix = root.querySelector<HTMLElement>('#protocolMatrix')!;
  const decisionGrid = root.querySelector<HTMLElement>('#protocolDecisionGrid')!;

  let selectedArea = 'all';
  let selectedStatus: ProtocolStatus | 'all' = 'all';
  let selectedGate = 'all';
  let selectedItemId = 'grammar-adr';
  let returnFocus: HTMLElement | null = null;
  const backgroundState = new Map<HTMLElement, { ariaHidden: string | null; inert: boolean }>();
  const backgroundNodes = [
    document.querySelector<HTMLElement>('.frame'),
    document.getElementById('drawer'),
    document.getElementById('telemetryModal'),
  ].filter((node): node is HTMLElement => Boolean(node));

  root.querySelector<HTMLElement>('#protocolSource')!.textContent = PROTOCOL_SOURCE_REVISION;
  root.querySelector<HTMLElement>('#protocolItemSummary')!.textContent = String(PROTOCOL_WORK_ITEMS.length);
  root.querySelector<HTMLElement>('#protocolAreaSummary')!.textContent = `across ${PROTOCOL_AREAS.length} systems`;
  root.querySelector<HTMLElement>('#protocolDecisionSummary')!.textContent = String(OPEN_PROTOCOL_DECISIONS.length);
  const passedGates = PROTOCOL_GATES.filter((gate) => gate.status === 'pass').length;
  root.querySelector<HTMLElement>('#protocolGateSummary')!.textContent = `${passedGates} / ${PROTOCOL_GATES.length}`;

  const setView = (view: ObservatoryView): void => {
    root.querySelectorAll<HTMLElement>('[data-protocol-view]').forEach((button) => {
      const selected = button.dataset.protocolView === view;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    root.querySelectorAll<HTMLElement>('[data-protocol-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.protocolPanel !== view;
    });
  };

  const renderAreas = (): void => {
    areaList.replaceChildren();
    const entries = [{ id: 'all', label: 'All systems' }, ...PROTOCOL_AREAS.map((area) => ({ id: area.id, label: area.shortLabel }))];
    for (const entry of entries) {
      const count = entry.id === 'all'
        ? PROTOCOL_WORK_ITEMS.length
        : PROTOCOL_WORK_ITEMS.filter((workItem) => workItem.areaId === entry.id).length;
      const button = make('button', 'protocol-filter-row');
      button.type = 'button';
      button.dataset.filterId = entry.id;
      button.dataset.selected = String(selectedArea === entry.id);
      button.append(make('span', '', entry.label), make('span', 'protocol-filter-row__count', String(count)));
      button.addEventListener('click', () => {
        selectedArea = entry.id;
        selectedGate = 'all';
        render();
        areaList.querySelector<HTMLElement>(`[data-filter-id="${entry.id}"]`)?.focus();
      });
      areaList.append(button);
    }
  };

  const renderStatuses = (): void => {
    statusList.replaceChildren();
    const entries: ReadonlyArray<{ id: ProtocolStatus | 'all'; label: string }> = [
      { id: 'all', label: 'Every status' },
      ...PROTOCOL_STATUSES.map((entry) => ({ id: entry.id, label: entry.label })),
    ];
    for (const entry of entries) {
      const count = entry.id === 'all'
        ? PROTOCOL_WORK_ITEMS.length
        : PROTOCOL_WORK_ITEMS.filter((workItem) => workItem.status === entry.id).length;
      const button = make('button', 'protocol-filter-row');
      button.type = 'button';
      button.dataset.filterId = entry.id;
      button.dataset.selected = String(selectedStatus === entry.id);
      button.dataset.status = entry.id;
      button.append(make('span', '', entry.label), make('span', 'protocol-filter-row__count', String(count)));
      button.addEventListener('click', () => {
        selectedStatus = entry.id;
        render();
        statusList.querySelector<HTMLElement>(`[data-filter-id="${entry.id}"]`)?.focus();
      });
      statusList.append(button);
    }
  };

  const renderGates = (): void => {
    gateRail.replaceChildren();
    for (const gate of PROTOCOL_GATES) {
      const button = make('button', 'protocol-gate');
      button.type = 'button';
      button.dataset.state = gate.status;
      button.dataset.gateId = gate.id;
      button.dataset.selected = String(selectedGate === gate.id);
      button.title = gate.requirement;
      button.setAttribute('aria-label', `${gate.id} ${gate.label}: ${gate.status}. ${gate.requirement}`);
      button.append(make('span', 'protocol-gate__id', gate.id), make('span', 'protocol-gate__label', gate.label));
      button.addEventListener('click', () => {
        selectedGate = selectedGate === gate.id ? 'all' : gate.id;
        selectedArea = 'all';
        setView('map');
        render();
        gateRail.querySelector<HTMLElement>(`[data-gate-id="${gate.id}"]`)?.focus();
      });
      gateRail.append(button);
    }
  };

  const filteredItems = (): readonly ProtocolWorkItem[] => {
    const query = search.value.trim().toLocaleLowerCase();
    return PROTOCOL_WORK_ITEMS.filter((workItem) => {
      if (selectedArea !== 'all' && workItem.areaId !== selectedArea) return false;
      if (selectedStatus !== 'all' && workItem.status !== selectedStatus) return false;
      if (selectedGate !== 'all' && workItem.gate !== selectedGate) return false;
      if (!query) return true;
      const haystack = [
        workItem.id,
        workItem.title,
        workItem.objective,
        workItem.why,
        workItem.gate,
        areaById.get(workItem.areaId)?.label ?? '',
        ...workItem.evidence,
      ].join(' ').toLocaleLowerCase();
      return haystack.includes(query);
    });
  };

  const selectItem = (id: string): void => {
    if (!byId.has(id)) return;
    selectedItemId = id;
    renderWork();
    renderDetail();
  };

  const renderInsights = (): void => {
    insights.replaceChildren();
    const active = PROTOCOL_WORK_ITEMS.filter((workItem) => workItem.status === 'active');
    const pressure = dependencyPressure().slice(0, 3);

    const activeBlock = make('div', 'protocol-insight');
    activeBlock.append(make('span', 'label', 'Now being done'));
    const activeText = make('p');
    activeText.textContent = active.map((workItem) => workItem.title).join(' · ');
    activeBlock.append(activeText);

    const blockers = make('div', 'protocol-insight');
    blockers.append(make('span', 'label', 'Highest dependency pressure'));
    const blockerList = make('div', 'protocol-insight__links');
    for (const entry of pressure) {
      const button = make('button', 'protocol-inline-link', `${entry.item.title} · ${entry.count}`);
      button.type = 'button';
      button.addEventListener('click', () => {
        selectedArea = 'all';
        selectedStatus = 'all';
        selectedGate = 'all';
        setView('map');
        selectItem(entry.item.id);
        render();
      });
      blockerList.append(button);
    }
    blockers.append(blockerList);
    insights.append(activeBlock, blockers);
  };

  const renderWork = (): void => {
    const items = filteredItems();
    workGrid.replaceChildren();
    root.querySelector<HTMLElement>('#protocolResultCount')!.textContent = `${items.length} shown`;
    const area = selectedArea === 'all' ? null : areaById.get(selectedArea);
    root.querySelector<HTMLElement>('#protocolWorkTitle')!.textContent =
      selectedGate !== 'all' ? `${selectedGate} obligations` : area?.label ?? 'All tracked obligations';

    if (items.length === 0) {
      const empty = make('div', 'protocol-empty');
      empty.append(make('strong', '', 'No obligations match this view.'), make('p', '', 'Reset the filters or search for a broader term.'));
      workGrid.append(empty);
      return;
    }

    for (const workItem of items) {
      const card = make('button', 'protocol-work-card');
      card.type = 'button';
      card.dataset.status = workItem.status;
      card.dataset.selected = String(workItem.id === selectedItemId);
      card.setAttribute('aria-label', `${workItem.title}, ${statusLabel(workItem.status)}, ${workItem.gate}`);

      const head = make('span', 'protocol-work-card__head');
      head.append(
        make('span', 'protocol-status', statusLabel(workItem.status)),
        make('span', 'protocol-work-card__gate', workItem.gate),
      );
      const title = make('strong', 'protocol-work-card__title', workItem.title);
      const objective = make('span', 'protocol-work-card__objective', workItem.objective);
      const meta = make('span', 'protocol-work-card__meta');
      meta.textContent = `${areaById.get(workItem.areaId)?.shortLabel ?? workItem.areaId} · ${workItem.dependencies.length} dependencies`;
      card.append(head, title, objective, meta);
      card.addEventListener('click', () => selectItem(workItem.id));
      workGrid.append(card);
    }
  };

  const renderDetail = (): void => {
    const workItem = byId.get(selectedItemId) ?? PROTOCOL_WORK_ITEMS[0];
    if (!workItem) return;
    detail.replaceChildren();

    const eyebrow = make('div', 'protocol-detail__eyebrow');
    eyebrow.append(
      make('span', 'protocol-status', statusLabel(workItem.status)),
      make('span', 'protocol-detail__gate', workItem.gate),
    );
    const title = make('h3', '', workItem.title);
    const area = make('p', 'protocol-detail__area', areaById.get(workItem.areaId)?.label ?? workItem.areaId);
    const objective = make('p', 'protocol-detail__objective', workItem.objective);

    const why = make('section', 'protocol-detail__section');
    why.append(make('span', 'label', 'Why it matters'), make('p', '', workItem.why));

    const evidence = make('section', 'protocol-detail__section');
    evidence.append(make('span', 'label', 'Current evidence'));
    const evidenceList = make('ul');
    for (const entry of workItem.evidence) evidenceList.append(make('li', '', entry));
    evidence.append(
      evidenceList,
      make('p', 'protocol-evidence-boundary', workItem.evidenceBoundary),
      make('p', 'protocol-evidence-policy', PROTOCOL_EVIDENCE_POLICY),
    );

    const dependency = make('section', 'protocol-detail__section');
    dependency.append(make('span', 'label', 'Depends on'));
    const dependencyList = make('div', 'protocol-detail__dependencies');
    if (workItem.dependencies.length === 0) {
      dependencyList.append(make('span', 'dim', 'No tracked upstream dependency'));
    } else {
      for (const id of workItem.dependencies) {
        const upstream = byId.get(id);
        const button = make('button', 'protocol-dependency', upstream?.title ?? id);
        button.type = 'button';
        button.addEventListener('click', () => {
          selectedArea = 'all';
          selectedStatus = 'all';
          selectedGate = 'all';
          selectItem(id);
          render();
        });
        dependencyList.append(button);
      }
    }
    dependency.append(dependencyList);

    const done = make('section', 'protocol-detail__section');
    done.append(make('span', 'label', 'Done means'));
    const doneList = make('ul', 'protocol-detail__checklist');
    for (const entry of workItem.completion) doneList.append(make('li', '', entry));
    done.append(doneList);

    detail.append(eyebrow, title, area, objective, why, evidence, dependency, done);
  };

  const renderMatrix = (): void => {
    matrix.replaceChildren();
    const table = make('table', 'protocol-matrix__table');
    const head = make('thead');
    const headRow = make('tr');
    for (const label of ['System', 'Specification', 'Implementation', 'Verification', 'Deployment', 'Risk']) {
      headRow.append(make('th', '', label));
    }
    head.append(headRow);
    const body = make('tbody');
    for (const area of PROTOCOL_AREAS) {
      const row = make('tr');
      const areaCell = make('th');
      const areaButton = make('button', 'protocol-matrix__area-link', area.shortLabel);
      areaButton.type = 'button';
      areaButton.addEventListener('click', () => {
        selectedArea = area.id;
        selectedGate = 'all';
        setView('map');
        render();
      });
      areaCell.append(areaButton);
      row.append(areaCell);
      for (const value of [area.axes.specification, area.axes.implementation, area.axes.verification, area.axes.deployment, area.axes.risk]) {
        const cell = make('td');
        cell.append(make('span', 'protocol-axis-value', value));
        row.append(cell);
      }
      body.append(row);
    }
    table.append(head, body);
    matrix.append(table);
  };

  const renderDecisions = (): void => {
    decisionGrid.replaceChildren();
    for (const decision of OPEN_PROTOCOL_DECISIONS) {
      const card = make('button', 'protocol-decision');
      card.type = 'button';
      card.append(
        make('span', 'protocol-decision__id', decision.id),
        make('strong', '', decision.title),
        make('span', 'protocol-decision__area', areaById.get(decision.areaId)?.shortLabel ?? decision.areaId),
        make('p', '', `Blocks: ${decision.blocks}`),
      );
      card.addEventListener('click', () => {
        const related = byId.get(decision.relatedWorkItemId);
        if (related) {
          selectedArea = 'all';
          selectedStatus = 'all';
          selectedGate = 'all';
          setView('map');
          selectItem(related.id);
          render();
        }
      });
      decisionGrid.append(card);
    }
  };

  const render = (): void => {
    renderAreas();
    renderStatuses();
    renderGates();
    renderInsights();
    renderWork();
    renderDetail();
    renderMatrix();
    renderDecisions();
  };

  const close = (): void => {
    root.hidden = true;
    document.body.dataset.protocolOpen = 'false';
    trigger.setAttribute('aria-expanded', 'false');
    for (const node of backgroundNodes) {
      const previous = backgroundState.get(node);
      node.inert = previous?.inert ?? false;
      if (previous?.ariaHidden === null || previous?.ariaHidden === undefined) {
        node.removeAttribute('aria-hidden');
      } else {
        node.setAttribute('aria-hidden', previous.ariaHidden);
      }
    }
    backgroundState.clear();
    returnFocus?.focus();
  };

  const open = (): void => {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : trigger;
    for (const node of backgroundNodes) {
      backgroundState.set(node, { ariaHidden: node.getAttribute('aria-hidden'), inert: node.inert });
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
    }
    root.hidden = false;
    document.body.dataset.protocolOpen = 'true';
    trigger.setAttribute('aria-expanded', 'true');
    render();
    search.focus();
  };

  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'protocolObservatory');
  trigger.addEventListener('click', () => root.hidden ? open() : close());
  root.querySelectorAll<HTMLElement>('[data-protocol-close]').forEach((node) => node.addEventListener('click', close));
  root.querySelector<HTMLElement>('#protocolClose')!.addEventListener('click', close);
  root.querySelector<HTMLElement>('#protocolReset')!.addEventListener('click', () => {
    search.value = '';
    selectedArea = 'all';
    selectedStatus = 'all';
    selectedGate = 'all';
    render();
  });
  root.querySelectorAll<HTMLElement>('[data-protocol-view]').forEach((button) => {
    button.addEventListener('click', () => setView(button.dataset.protocolView as ObservatoryView));
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...root.querySelectorAll<HTMLElement>('[data-protocol-view]')];
      const index = tabs.indexOf(button);
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      const next = tabs[nextIndex];
      if (!next) return;
      setView(next.dataset.protocolView as ObservatoryView);
      next.focus();
    });
  });
  search.addEventListener('input', () => {
    setView('map');
    renderWork();
  });

  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      .filter((node) => !node.hidden && node.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  render();
}
