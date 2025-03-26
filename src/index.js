const p = require('puppeteer');
const { setTimeout } = require('timers/promises');
const fs = require('fs');
const path = require('path');

const formatPriceToNumber = (price) => {
  return Number(price.replace(/[^0-9,]/g, '').replace(',', '.'));
};

const createJsonOutput = (file) => {
  const dirPath = path.resolve(__dirname, '../result/');
  const outPath = path.resolve(__dirname, '../result/output.json');

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
  }

  try {
    const jsonFormat = JSON.stringify(file, null, 2);
    fs.writeFileSync(outPath, jsonFormat);
    console.log(`A saída dos dados foi salva em: ${outPath}`);
  } catch (e) {
    console.log(`Falha ao escrever o arquivo. Tente novamene: ${e}`);
  }
};

const createProduct = (title, price, url) => ({
  title,
  price,
  url,
});

(async () => {
  let catId = 1;
  let categories;
  let page;

  const productsResult = [];
  const productsByCategory = [];

  const ACTION_TIMEOUT = 1250;

  console.log('Executando Web Scraper\n');
  console.log('Iniciando o broswer...\n');

  //starts the Puppeteer browser.
  const browser = await p.launch({
    headless: true, //Change this parameter to false, to disable headless and view the interactions on the screen.
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const baseUrl = 'https://mercado.carrefour.com.br/';
  const baseEndpoint = 'bebidas';
  const url = `${baseUrl}${baseEndpoint}`;

  try {
    page = await browser.newPage();

    await page.setRequestInterception(true);

    page.on('request', (req) => {
      if (['image'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log(`Acessando página ${url}...\n`);

    await page.goto(url, { waitUntil: 'networkidle2' });
    const button = await page.waitForSelector(
      '::-p-xpath(//button[@title="Insira seu CEP"])',
      {
        visible: true,
      },
    );

    console.log(`Selecionando loja Hiper Piracicaba...\n`);
    await button.click();

    const storeSelectorBtn = await page.waitForSelector(
      '::-p-xpath(//button[span[contains(text(), "Retire na Loja")]])',
      { visible: true },
    );

    storeSelectorBtn.click();
    await setTimeout(ACTION_TIMEOUT);

    const citySelector = await page.waitForSelector('#selectCity', {
      visible: true,
    });

    citySelector.select('Piracicaba');
    await setTimeout(ACTION_TIMEOUT);

    const piracicabaButton = await page.waitForSelector('#selectCity + div', {
      visible: true,
    });

    piracicabaButton.click();
    await setTimeout(ACTION_TIMEOUT);
    console.log(`Loja Selecionada\n`);

    const showPagOptions = await page.waitForSelector(
      '::-p-xpath(//button[@data-testid="store-button" and contains(text(), "Exibindo")])',
    );

    showPagOptions.click();
    await setTimeout(ACTION_TIMEOUT);

    const pagButton60 = await page.waitForSelector(
      '::-p-xpath(//button[@data-testid="store-button" and contains(text(), "60")])',
    );

    pagButton60.click();
    await setTimeout(ACTION_TIMEOUT);

    //Captures category filter information and formats their names into endpoint format, to access them one by one later.
    categories = await page.$$eval(
      '::-p-xpath(//button[contains(text(), "Categoria")]) + div > ul > li',
      (categories) =>
        categories.map((category) => ({
          category: category.innerText,
          categoryEndpoint: category.innerText
            .toLowerCase()
            .split(' ')
            .join('-')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, ''),
        })),
    );

    console.log('Mapeando produtos por categoria. Aguarde... \n');
  } catch (e) {
    console.error(`Falha na comunicação. Por favor, tente novamente: ${e}`);
    await browser.close();
  }

  let counter = 1;
  // Product mapping loop by category, capturing its information
  for (const { category, categoryEndpoint } of categories) {
    if (category === 'Gelo') {
      counter++;
      continue;
    }

    let currentPage = 1;
    let categoryUrl = `${url}/${categoryEndpoint}?page=${currentPage}`;
    await page.goto(categoryUrl);

    await page.waitForSelector('h2[data-testid="total-product-count"] span');

    const productsPerPage = 60;

    const totalProducts = await page.$eval(
      'h2[data-testid="total-product-count"] span',
      (el) => +el.innerText,
    );
    const totalPages = Math.ceil(totalProducts / productsPerPage);

    productsByCategory.push({
      category,
      productsLink: [],
      names: [],
      prices: [],
    });

    let categoryIndex = productsByCategory.findIndex(
      (product) => product.category === category,
    );

    console.log(
      `Mapeando categoria ${counter} de ${categories.length}: ${category}`,
    );

    console.log(`----Página ${currentPage} de ${totalPages}`);

    // Starts the categorization loop and captures product information.
    do {
      try {
        // Wait for the product cards to appear on the screen.
        await page.waitForSelector('ul > li > article', {
          visible: true,
          timeout: 10000,
        });

        // capture all the links of the products.
        const links = await page.$$eval(
          'ul > li > article > div > section > h3 > span > a',
          (links) => links.map((link) => link.href),
        );

        // capture all the titles of the products.
        const names = await page.$$eval(
          'ul > li > article > div > section > h3 > span',
          (names) => names.map((name) => name.title),
        );

        const cards = await page.$$('ul > li > article');

        // capture all the prices of the products.
        const prices = await Promise.all(
          cards.map(async (card) => {
            // captures all spans with data-test-id="price" inside the card.
            const spans = await card.$$(
              'div section div div span[data-test-id="price"]',
            );

            if (spans.length > 0) {
              // Always grabs the last price inside the card, to avoid capturing two prices when the card has both the regular price and the discounted price.
              return await spans[spans.length - 1].evaluate((el) =>
                el.textContent.trim(),
              );
            }

            return null;
          }),
        );

        const validPrices = prices.filter((price) => price !== null);

        for (const link of links) {
          productsByCategory[categoryIndex].productsLink.push(link);
        }

        for (const name of names) {
          productsByCategory[categoryIndex].names.push(name);
        }

        for (const price of validPrices) {
          productsByCategory[categoryIndex].prices.push(
            formatPriceToNumber(price),
          );
        }

        if (totalPages === 1 || currentPage === totalPages) break;

        currentPage++;
        console.log(`----Página ${currentPage} de ${totalPages}`);

        categoryUrl = `${url}/${categoryEndpoint}?page=${currentPage}`;

        await page.goto(categoryUrl);
      } catch {
        break;
      }
    } while (currentPage <= totalPages);

    const count = productsByCategory[categoryIndex].names.length;

    productsResult.push({
      id: catId,
      category,
      count,
      products: [],
    });

    let productCategoryIndex = productsResult.findIndex(
      (product) => product.category === category,
    );

    //Extracts the title, price, and URL of products by category, to insert into the final array, organizing them by category.
    for (let i = 0; i < count; i++) {
      const title = productsByCategory[categoryIndex].names[i];
      const price = productsByCategory[categoryIndex].prices[i];
      const url = productsByCategory[categoryIndex].productsLink[i];

      productsResult[productCategoryIndex].products.push(
        createProduct(title, price, url),
      );
    }

    console.log(`A categoria ${category} foi mapeada com sucesso ✅ \n`);
    counter++;
    catId++;
  }

  console.log('Mapeamento concluído');

  createJsonOutput(productsResult);

  await browser.close();
})();
