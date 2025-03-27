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
    maxConcurrency: 7, // defines the maximum number of concurrent browser instances.
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

// provides a category list of beverages, returning an array with objects containing: name, label, categoryUrs
const getCategoriesList = (apiResult, url) => {
  const {
    data: {
      search: { facets },
    },
  } = apiResult;

  const categoryInfo = facets
    .map((facet) => facet)
    .find(({ label }) => label === 'Categoria');

  const { values: categories } = categoryInfo;

  return categories.map(({ label: name, value: label }) => ({
    name,
    label,
    categoryUrl: `${url}/${label}`,
  }));
};

//processes API results to extract and format product information
const categorizeProducts = (apiResults, categoryName) => {
  const baseUrl = 'https://mercado.carrefour.com.br';
  let formatedProducts = []; //store formatted product data

  apiResults.forEach((productsData) => {
    // destructuring to extract product list from API response (edges)
    const {
      data: {
        search: {
          products: { edges },
        },
      },
    } = productsData;

    // mapping over products to extract them relevant information
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

  //creates a category object with the information extracted to pushes into categorizedProducts array
  const category = {
    id: categoryId,
    count: formatedProducts.length,
    name: categoryName,
    products: formatedProducts,
  };

  categorizedProducts.categories.push(category); // inserts the categorized information into the 'categorizedProducts' array
  categoryId++;
  return category.products.length; //returns the quantity of products extracted in such category
};

// fetches product data from carrefour Api with specific filters
const apiCall = async (after, categoryLabel) => {
  const MAX_PRODUCTS_PER_CALL = 100; // maximum products per call allowed by api
  const PIRACICABA_REGION_ID = 'v2.16805FBD22EC494F5D2BD799FE9F1FB7'; //specifies the region id of the piracicaba store

  //constructs api query parameters for filtering products, extracted by looking at the api call in the chrome network tab (decoded by an online decoder).
  let apiQueryParams = {
    isPharmacy: false,
    first: MAX_PRODUCTS_PER_CALL,
    after: `${after}`, //cursor for pagination to fetch the next set of products (if the first result > 100)
    sort: 'score_desc',
    term: '',
    selectedFacets: [
      { key: 'category-1', value: 'bebidas' },
      { key: 'category-1', value: '1279' },
      { key: 'category-2', value: categoryLabel }, //specifies which category the products will be extracted from
      {
        key: 'channel',
        value: JSON.stringify({
          salesChannel: 2,
          regionId: PIRACICABA_REGION_ID,
        }),
      },
      { key: 'locale', value: 'pt-BR' },
      { key: 'region-id', value: PIRACICABA_REGION_ID },
    ],
  };

  // encodes the query parameters to be used in the api url
  const encodedParams = encodeURIComponent(JSON.stringify(apiQueryParams));
  const completeUrl = `https://mercado.carrefour.com.br/api/graphql?operationName=ProductsQuery&variables=${encodedParams}`;

  // defines request headers to mimic a real browser request to avoid any blocks
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    Referer: `https://mercado.carrefour.com.br/bebidas/${categoryLabel}`, // sets referer to simulate navigation
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

//fetches all products from a category using paginated api requests
const getProductsByApiRequest = async (categoryLabel, categoryName) => {
  const MAX_PRODUCTS_PER_CALL = 100;
  const apiResults = [];
  let afterNum = 0;

  // makes the initial api call to get the first list of products
  let response = await apiCall(afterNum, categoryLabel);

  const totalProducts = response.data.search.products.pageInfo.totalCount;

  apiResults.push(response);

  // if there're more products than the max per call (100), continue fetching in batches
  if (totalProducts > MAX_PRODUCTS_PER_CALL) {
    afterNum += 100;
    while (afterNum < totalProducts) {
      apiResults.push(await apiCall(afterNum, categoryLabel));
      afterNum += 100;
    }
  }

  // sends gathered data to the categorization function
  categorizeProducts(apiResults, categoryName);

  return totalProducts;
};

// it defines a task for the pupeteer-cluster to fetch products in parallel actions
const clusterTask = async (cluster) => {
  await cluster.task(async ({ data: { label, name } }) => {
    console.log(`>> Obtendo produtos da categoria ${name} 🔍\n`);
    try {
      let totalProductsFinded = 0;

      totalProductsFinded = await getProductsByApiRequest(label, name);

      console.log(
        `>> Total de ${totalProductsFinded} produtos obtidos da categoria: ${name} ✅\n`,
      );
    } catch (e) {
      console.error(`>> Falha na execução desta instância: ${e} ❌\n`);
    }
  });
};

// delegates to each generated cluster a different category, to obtain its products
const getProductsByCategory = async (categoriesUrlList) => {
  const cluster = await initCluster();
  // let counter = 0;

  await clusterTask(cluster); // defines the cluster task for processing products

  // iterates over the category list and adds each category to the cluster queue
  for (const { label, name } of categoriesUrlList) {
    await cluster.queue({ label, name });
    // counter++;
    // if (counter === 4) break; //limits the processing categories, to debbuging purposes
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
    headless: true, //Change this parameter to false, to disable headless and view the interactions on the screen.
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
