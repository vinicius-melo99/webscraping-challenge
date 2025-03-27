const p = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { setTimeout } = require('timers/promises');
const { Cluster } = require('puppeteer-cluster');

const categorizedProducts = { categories: [] };
let categoryId = 1;

// inits cluster of puppeteer-cluster
const initCluster = () => {
  return Cluster.launch({
    concurrency: Cluster.CONCURRENCY_BROWSER,
    maxConcurrency: 5,
    puppeteerOptions: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });
};

// functions to create the final json outpout file with the results
const createJsonOutput = (file) => {
  const dirPath = path.resolve(__dirname, '../result/');
  const outPath = path.resolve(__dirname, '../result/output.json');

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
  }

  try {
    const jsonFormat = JSON.stringify(file, null, 2);
    fs.writeFileSync(outPath, jsonFormat);
    console.log(
      `✅ Execução concluída! A saída dos dados foi salva em: ${outPath} ✅`,
    );
  } catch (e) {
    console.log(`Falha ao escrever o arquivo. Tente novamene: ${e}`);
  }
};

// provides a category list of drinks, returning an array with objects containing: name, label, categoryUrs
const getCategoriesList = (apiResult, url) => {
  const {
    data: {
      search: { facets },
    },
  } = apiResult;

  const [categoryInfo] = facets
    .map((facet) => facet)
    .filter(({ label }) => label === 'Categoria');

  const { values: categories } = categoryInfo;

  return categories.map(({ label: name, value: label }) => ({
    name,
    label,
    categoryUrl: `${url}/${label}`,
  }));
};

const categorizeProducts = (apiResults, categoryName) => {
  const baseUrl = 'https://mercado.carrefour.com.br';
  let formatedProducts = [];

  apiResults.forEach((productsData) => {
    let {
      data: {
        search: {
          products: { edges },
        },
      },
    } = productsData;

    formatedProducts = [
      ...formatedProducts,
      ...edges.map(({ node }) => ({
        id: node.id,
        name: node.name || 'sem informação',
        slug: node.slug || 'sem informação',
        brand: node.brand.brandName || 'sem informação',
        price: node.offers.lowPrice || 'sem informação',
        url: `${baseUrl}/${node.slug || 'sem informação'}/p`,
      })),
    ];
  });

  const category = {
    id: categoryId,
    count: formatedProducts.length,
    name: categoryName,
    products: formatedProducts,
  };

  categorizedProducts.categories.push(category);
  categoryId++;
  return category.products.length;
};

const apiCall = async (after, categoryLabel) => {
  const MAX_PRODUCTS_PER_CALL = 100;
  let apiQueryParams = {
    isPharmacy: false,
    first: MAX_PRODUCTS_PER_CALL,
    after: `${after}`,
    sort: 'score_desc',
    term: '',
    selectedFacets: [
      { key: 'category-1', value: 'bebidas' },
      { key: 'category-1', value: '1279' },
      { key: 'category-2', value: categoryLabel },
      {
        key: 'channel',
        value: JSON.stringify({
          salesChannel: 2,
          regionId: 'v2.16805FBD22EC494F5D2BD799FE9F1FB7',
        }),
      },
      { key: 'locale', value: 'pt-BR' },
      { key: 'region-id', value: 'v2.16805FBD22EC494F5D2BD799FE9F1FB7' },
    ],
  };
  const encodedParams = encodeURIComponent(JSON.stringify(apiQueryParams));
  const completeUrl = `https://mercado.carrefour.com.br/api/graphql?operationName=ProductsQuery&variables=${encodedParams}`;
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    Referer: `https://mercado.carrefour.com.br/bebidas/${categoryLabel}`,
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  };

  const response = await fetch(completeUrl, {
    headers: {
      ...headers,
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  return data;
};

const getProductsByApiRequest = async (categoryLabel, categoryName) => {
  const MAX_PRODUCTS_PER_CALL = 100;
  const apiResults = [];
  let afterNum = 0;

  let response = await apiCall(afterNum, categoryLabel);

  const totalProducts = response.data.search.products.pageInfo.totalCount;

  apiResults.push(response);

  if (totalProducts > MAX_PRODUCTS_PER_CALL) {
    afterNum += 100;
    while (afterNum < totalProducts) {
      apiResults.push(await apiCall(afterNum, categoryLabel));
      afterNum += 100;
    }
  }

  categorizeProducts(apiResults, categoryName);
  return totalProducts;
};

const clusterTask = async (cluster) => {
  await cluster.task(async ({ page, data: { url, label, name } }) => {
    console.log(`>> Obtendo produtos da categoria ${name} 🔍\n`);
    try {
      let totalProductsFinded = 0;
      await page.setRequestInterception(true);

      page.on('request', (req) => {
        if (
          ['image', 'stylesheet', 'font', 'fetch', 'xhr'].includes(
            req.resourceType(),
          )
        ) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(url, { waitUntil: 'domcontentloaded' });

      totalProductsFinded = await getProductsByApiRequest(label, name);

      console.log(
        `>> Total de ${totalProductsFinded} produtos obtidos da categoria: ${name} ✅\n`,
      );
    } catch (e) {
      console.error(`>> Falha na execução desta instância: ${e} ❌\n`);
    }
  });
};

const getProductsByCategory = async (categoriesUrlList) => {
  const cluster = await initCluster();
  // let counter = 0;
  await clusterTask(cluster);

  for (const { categoryUrl, label, name } of categoriesUrlList) {
    await cluster.queue({ url: categoryUrl, label, name });
    // counter++;

    // if (counter === 10) break;
  }

  await cluster.idle();
  await cluster.close();

  createJsonOutput(categorizedProducts);
};

(async () => {
  const PRODUCTS_API_URL =
    'https://mercado.carrefour.com.br/api/graphql?operationName=ProductGalleryQuery';
  const ACTION_TIMEOUT = 1300;

  console.log('>> Executando o Carrefour Web Scraper 🛒\n');
  console.log('>> Iniciando o broswer...⌛\n ');

  //starts the Puppeteer browser.
  const browser = await p.launch({
    headless: false, //Change this parameter to false, to disable headless and view the interactions on the screen.
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const baseUrl = 'https://mercado.carrefour.com.br/';
  const baseEndpoint = 'bebidas';
  const url = `${baseUrl}${baseEndpoint}`;
  const apiResults = [];

  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    let interceptionCounter = 0;

    page.on('request', (req) => {
      if (req.url().includes(PRODUCTS_API_URL)) {
        if (interceptionCounter < 1) {
          console.log(`>> Interceptando chamada à API em ${url} 🌐\n`);
        }
        interceptionCounter++;
      }
      req.continue();
    });

    page.on('response', async (res) => {
      const req = res.request();
      if (req.url().includes(PRODUCTS_API_URL)) {
        try {
          const responseJson = await res.json();
          apiResults.push(responseJson);
        } catch (error) {
          console.log(`Erro ao interceptar o arquivo: ${error}`);
        }
      }
    });

    console.log(`>> Acessando página ${url}...\n`);
    await page.goto(url, { waitUntil: 'networkidle2' });

    const button = await page.waitForSelector(
      '::-p-xpath(//button[@title="Insira seu CEP"])',
      {
        visible: true,
      },
    );

    console.log(`>> Selecionando loja Hiper Piracicaba...\n`);
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
    console.log(`>> Loja Selecionada ✅\n`);

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

    console.log('>> Iniciando mapeamento de produtos, aguarde... ⌛\n');

    const lastApiResult = apiResults[apiResults.length - 1];

    const categories = getCategoriesList(lastApiResult, url);

    await getProductsByCategory(categories);
  } catch (e) {
    console.error(
      `>> ❌ Falha na comunicação. Por favor, tente novamente: ${e} ❌`,
    );
  } finally {
    await browser.close();
  }
})();
