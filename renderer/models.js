// Claude model families, versions and supported effort levels.
// Shared by the main process (require) and the renderer (<script>).
(function (root) {
  const ALL = ['low', 'medium', 'high', 'xhigh', 'max'];
  const NO_XHIGH = ['low', 'medium', 'high', 'max'];

  // The first version in each list is the newest. The family alias ("opus", ...) always means
  // the newest version in Claude Code, so picking "Latest" keeps working when new models ship.
  const FAMILIES = [
    {
      key: 'fable',
      name: 'Fable',
      versions: [
        { id: 'claude-fable-5-2', label: '5.2' },
        { id: 'claude-fable-5-1', label: '5.1' },
        { id: 'claude-fable-5', label: '5' },
      ],
    },
    {
      key: 'opus',
      name: 'Opus',
      versions: [
        { id: 'claude-opus-5-5', label: '5.5' },
        { id: 'claude-opus-5', label: '5' },
        { id: 'claude-opus-4-8', label: '4.8' },
        { id: 'claude-opus-4-7', label: '4.7' },
        { id: 'claude-opus-4-6', label: '4.6', efforts: NO_XHIGH },
      ],
    },
    {
      key: 'sonnet',
      name: 'Sonnet',
      versions: [
        { id: 'claude-sonnet-5-5', label: '5.5' },
        { id: 'claude-sonnet-5', label: '5' },
        { id: 'claude-sonnet-4-6', label: '4.6', efforts: NO_XHIGH },
      ],
    },
    {
      key: 'haiku',
      name: 'Haiku',
      versions: [
        { id: 'claude-haiku-5-5', label: '5.5' },
        { id: 'claude-haiku-4-5', label: '4.5', efforts: [] },
      ],
    },
  ];

  // model: '' (Claude Code default), a family alias ('opus') or a full ID ('claude-opus-5').
  function parse(model) {
    if (!model) return { family: '', version: '' };
    for (const f of FAMILIES) {
      if (model === f.key) return { family: f.key, version: '' };
      if (f.versions.some((v) => v.id === model)) return { family: f.key, version: model };
    }
    return { family: '', version: '' };
  }

  function efforts(model) {
    const { family, version } = parse(model);
    if (!version) return ALL; // default or "latest": current models support every level
    const f = FAMILIES.find((x) => x.key === family);
    const v = f.versions.find((x) => x.id === version);
    return v.efforts || ALL;
  }

  const api = { FAMILIES, EFFORTS: ALL, parse, efforts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MODELS = api;
})(typeof window !== 'undefined' ? window : globalThis);
