const api = globalThis.browser ?? globalThis.chrome;
const select = document.querySelector('#scale');
const status = document.querySelector('#status');

async function initialize() {
  const { scale } = await api.storage.local.get({ scale: 2 });
  select.value = String([2, 4].includes(Number(scale)) ? scale : 2);
}

initialize();

select.addEventListener('change', async () => {
  await api.storage.local.set({ scale: Number(select.value) });
  status.textContent = 'Saved.';
  setTimeout(() => { status.textContent = ''; }, 1800);
});
