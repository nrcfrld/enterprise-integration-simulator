# Node.js / TypeScript signed client

```bash
cd apps/marketplace/examples/node-client
npm install
MARKETPLACE_CLIENT_ID=client_xxx MARKETPLACE_CLIENT_SECRET=sec_xxx npm start
```

The example signs `GET /api/shopee/v1/products?page_no=1&page_size=10` with the Shopee-like `PARTNER_ID + PATH + TIMESTAMP + RAW_BODY` contract. Query parameters are sent to the server but excluded from the signed path.
