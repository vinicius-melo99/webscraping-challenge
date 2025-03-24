const p = require('puppeteer');

(async () => {
  const url = 'https://mercado.carrefour.com.br/';
  const browser = await p.launch();

  const page = await browser.newPage();

  await page.goto(url);

  await browser.close();
})();
