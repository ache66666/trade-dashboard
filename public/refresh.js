function maskPendingData() {
  const pendingSymbols = typeof indicators === 'undefined' ? [] : indicators.filter(x => x.source === '待手工录入').map(x => x.symbol);
  document.querySelectorAll('.card,.metric-row,.ticker-item').forEach(element => {
    if (!element.textContent.includes('待手工录入') && !pendingSymbols.some(symbol => element.textContent.includes(symbol))) return;
    const value = element.querySelector('.card-value,.metric-value') || (element.classList.contains('ticker-item') ? element.querySelector('b') : null);
    const change = element.querySelector('.card-change,.metric-change,strong');
    if (value) value.textContent = '待录入';
    if (change) change.textContent = '—';
  });
}
new MutationObserver(maskPendingData).observe(document.body, { childList: true, subtree: true });
maskPendingData();

document.querySelector('#refreshBtn').onclick = async () => {
  const button = document.querySelector('#refreshBtn');
  button.disabled = true;
  button.textContent = '更新中…';
  try {
    const response = await fetch('/api/refresh', { method: 'POST' });
    const result = await response.json();
    await load();
    maskPendingData();
    const count = (result.results || []).filter(x => x.status === 'updated').length;
    toast(`已从公开数据源更新 ${count} 项指标`);
  } catch (error) {
    toast(`自动更新失败：${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = '↻ 刷新';
  }
};
