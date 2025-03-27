# 🛒 Carrefour Web Scraper

Neste projeto foi desenvolvida uma solução que mapeia todas as informações do setor de bebidas do carrefour (loja Hiper Piracicaba). Este algorítmo é capaz de:

- Acessar o link "https://mercado.carrefour.com.br/bebidas" através do Puppeteer;
- Selecionar automaticamente a loja Hiper Piracicaba, através interações dinâmicas com os elementos da página;
- Realizar a filtragem para exibição de 60 produtos por página;
- Mapeia todas as categorias encontradas de bebidas interceptando a chamada à API do Carrefour;
- Faz o acesso a cada categoria para mapear cada um de seus produtos;
- Obtém os dados dos produtos de forma eficiente via fetch da API;
- Salva as informações capturadas organizadas por categorias, em um arquivo presente em "result/output.json", após a execução;

## 📝 Instruções para rodar o projeto localmente:

Clone o meu repositório:

```bash
git clone git@github.com:vinicius-melo99/webscraping-challenge.git
```
Na raiz do projeto, instale as dependências executando o seguinte comando:

```bash
npm install
```

Caso queira executar o script sem headless (exibindo as interações com o navegador na tela), altere a linha 233 em "src/index.js", definindo o headless para 'false':

```js
  const browser = await p.launch({
    headless: true, //alterar este parâmetro para false, para desativar o headless
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
```

Execute o script na raiz com:

```bash
npm start
```
Ou
```bash
node src/index.js
```

### Após a execução, o progresso poderá ser acompanhado na tela. Ao término, a saída será salva na raiz: "result/output.json"

# 🔄 Changelog

### 📌 [1.1.0] - 26/03/2025
- Melhorias significativas de desempenho;
- Adição do puppteer-cluster, para executar tarefas paralelamente;
- Adicionada interceptação/chamada às API's do Carrefour via fetch para capturar os dados de forma mais eficiente
