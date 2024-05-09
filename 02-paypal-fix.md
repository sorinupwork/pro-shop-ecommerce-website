# PayPal Fix

We ended up realizing there were a couple pretty big security issues with the PayPal integration and with the tax and price calculation. The first issue is if someone is tech savvy enough, they could bypass the app and make a request to `/orders/pay` and mark their orders as `isPaid` without paying. The second is that that the price and tax are calculated on the client. This means that the client can change the price and tax and then send the request to the server. We need to make sure that the price and tax are calculated on the server.

I like to be 100% transparent, so I want to let you guys know this and also show you how to fix it.

All of the changes have been added to the main repo here - https://github.com/bradtraversy/proshop-v2. We are going to go through step by step though.

## `Paypal .env Variables`

We will start by adding the following variables to the `.env` file:

```bash
PAYPAL_APP_SECRET=your_paypal_app_secret
PAYPAL_API_URL=https://api-m.sandbox.paypal.com
```

You can get these values from the [PayPal Developer Dashboard](https://developer.paypal.com/developer/applications/). When you are ready to go live, you can change the `PAYPAL_API_URL` to `https://api-m.paypal.com`.

## `Paypal API Call`

Create a file at `backend/utils/paypal.js` and add the following code:

```js
import dotenv from 'dotenv';
dotenv.config();
const { PAYPAL_CLIENT_ID, PAYPAL_APP_SECRET, PAYPAL_API_URL } = process.env;

/**
 * Fetches an access token from the PayPal API.
 * @see {@link https://developer.paypal.com/reference/get-an-access-token/#link-getanaccesstoken}
 *
 * @returns {Promise<string>} The access token if the request is successful.
 * @throws {Error} If the request is not successful.
 *
 */
async function getPayPalAccessToken() {
  // Authorization header requires base64 encoding
  const auth = Buffer.from(PAYPAL_CLIENT_ID + ':' + PAYPAL_APP_SECRET).toString(
    'base64'
  );

  const url = `${PAYPAL_API_URL}/v1/oauth2/token`;

  const headers = {
    Accept: 'application/json',
    'Accept-Language': 'en_US',
    Authorization: `Basic ${auth}`,
  };

  const body = 'grant_type=client_credentials';
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  if (!response.ok) throw new Error('Failed to get access token');

  const paypalData = await response.json();

  return paypalData.access_token;
}

/**
 * Checks if a PayPal transaction is new by comparing the transaction ID with existing orders in the database.
 *
 * @param {Mongoose.Model} orderModel - The Mongoose model for the orders in the database.
 * @param {string} paypalTransactionId - The PayPal transaction ID to be checked.
 * @returns {Promise<boolean>} Returns true if it is a new transaction (i.e., the transaction ID does not exist in the database), false otherwise.
 * @throws {Error} If there's an error in querying the database.
 *
 */
export async function checkIfNewTransaction(orderModel, paypalTransactionId) {
  try {
    // Find all documents where Order.paymentResult.id is the same as the id passed paypalTransactionId
    const orders = await orderModel.find({
      'paymentResult.id': paypalTransactionId,
    });

    // If there are no such orders, then it's a new transaction.
    return orders.length === 0;
  } catch (err) {
    console.error(err);
  }
}

/**
 * Verifies a PayPal payment by making a request to the PayPal API.
 * @see {@link https://developer.paypal.com/docs/api/orders/v2/#orders_get}
 *
 * @param {string} paypalTransactionId - The PayPal transaction ID to be verified.
 * @returns {Promise<Object>} An object with properties 'verified' indicating if the payment is completed and 'value' indicating the payment amount.
 * @throws {Error} If the request is not successful.
 *
 */
export async function verifyPayPalPayment(paypalTransactionId) {
  const accessToken = await getPayPalAccessToken();
  const paypalResponse = await fetch(
    `${PAYPAL_API_URL}/v2/checkout/orders/${paypalTransactionId}`,
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );
  if (!paypalResponse.ok) throw new Error('Failed to verify payment');

  const paypalData = await paypalResponse.json();
  return {
    verified: paypalData.status === 'COMPLETED',
    value: paypalData.purchase_units[0].amount.value,
  };
}
```

In a nutshell, what we are doing here is creating a function that will get the access token from PayPal and then we will use that access token to verify the payment. We will also create a function to check if the transaction is new or not.

Let's go through each function one by one.

### `getPayPalAccessToken()`

This function will get the access token from PayPal. We will use this access token to verify the payment.

- We first convert the `PAYPAL_CLIENT_ID` and `PAYPAL_APP_SECRET` to base64 encoding and then we make a `POST` request to the PayPal API to get the access token.
- We send the `Authorization` header with the base64 encoded string.
- We also need to set the body to `grant_type=client_credentials` as per the [PayPal API documentation](https://developer.paypal.com/docs/api/get-an-access-token-curl/).
- If the request is successful, we return the access token. If it is not successful, we throw an error.

### `checkIfNewTransaction()`

This function will check if the transaction is new or not. We will use this function to make sure that we don't verify the same transaction twice.

- We first find all the orders in the database where the `paymentResult.id` is the same as the `paypalTransactionId` that we pass to the function.
- If there are no such orders, then it's a new transaction and we return `true`. If there are such orders, then it's not a new transaction and we return `false`.

### `verifyPayPalPayment()`

This function will verify the payment by making a request to the PayPal API.

- We first get the access token from the `getPayPalAccessToken()` function.
- We then make a `GET` request to the PayPal API to get the order details.
- If the request is successful, we return an object with properties `verified` indicating if the payment is completed and `value` indicating the payment amount. If the request is not successful, we throw an error.

## Calculate Prices On Server

The next things we need to address is the price and tax calculation. Right now, we are doing this all on the client. The issue with that is that the client can change the price and tax and then send the request to the server. We need to make sure that the price and tax are calculated on the server.

Create another file at `backend/utils/calcPrices.js` and add the following code:

```js
function addDecimals(num) {
  return (Math.round(num * 100) / 100).toFixed(2);
}

export function calcPrices(orderItems) {
  // Calculate the items price
  const itemsPrice = addDecimals(
    orderItems.reduce((acc, item) => acc + item.price * item.qty, 0)
  );
  // Calculate the shipping price
  const shippingPrice = addDecimals(itemsPrice > 100 ? 0 : 10);
  // Calculate the tax price
  const taxPrice = addDecimals(Number((0.15 * itemsPrice).toFixed(2)));
  // Calculate the total price
  const totalPrice = (
    Number(itemsPrice) +
    Number(shippingPrice) +
    Number(taxPrice)
  ).toFixed(2);
  return { itemsPrice, shippingPrice, taxPrice, totalPrice };
}
```

This is almost identical to what we did in the frontend, except that we are doing it on the server.

## Use Our New Functions

Now open the `backend/controllers/orderController.js` file and import our new functions as well as the product model:

```js
import Product from '../models/productModel.js';
import { calcPrices } from '../utils/calcPrices.js';
import { verifyPayPalPayment, checkIfNewTransaction } from '../utils/paypal.js';
```

Replace the entire `addOrderItems()` function with the following:

```js
const addOrderItems = asyncHandler(async (req, res) => {
  const { orderItems, shippingAddress, paymentMethod } = req.body;

  if (orderItems && orderItems.length === 0) {
    res.status(400);
    throw new Error('No order items');
  } else {
    // get the ordered items from our database
    const itemsFromDB = await Product.find({
      _id: { $in: orderItems.map((x) => x._id) },
    });

    // map over the order items and use the price from our items from database
    const dbOrderItems = orderItems.map((itemFromClient) => {
      const matchingItemFromDB = itemsFromDB.find(
        (itemFromDB) => itemFromDB._id.toString() === itemFromClient._id
      );
      return {
        ...itemFromClient,
        product: itemFromClient._id,
        price: matchingItemFromDB.price,
        _id: undefined,
      };
    });

    // calculate prices
    const { itemsPrice, taxPrice, shippingPrice, totalPrice } =
      calcPrices(dbOrderItems);

    const order = new Order({
      orderItems: dbOrderItems,
      user: req.user._id,
      shippingAddress,
      paymentMethod,
      itemsPrice,
      taxPrice,
      shippingPrice,
      totalPrice,
    });

    const createdOrder = await order.save();

    res.status(201).json(createdOrder);
  }
});
```

Let's go over this code block by block.

Since we are going to calculate the prices on the server, we can get rid of the following imports from the body:

```js
  itemsPrice,
  taxPrice,
  shippingPrice,
  totalPrice,
```

So it should look like this:

```js
const { orderItems, shippingAddress, paymentMethod } = req.body;
```

Now, in the `else` block, we need to get the ordered items from the database. Add the following code:

```js
const itemsFromDB = await Product.find({
  _id: { $in: orderItems.map((x) => x._id) },
});
```

Now, map over the `itemsFromDB` and use the price from our items from the database:

```js
const dbOrderItems = orderItems.map((itemFromClient) => {
  const matchingItemFromDB = itemsFromDB.find(
    (itemFromDB) => itemFromDB._id.toString() === itemFromClient._id
  );
  return {
    ...itemFromClient,
    product: itemFromClient._id,
    price: matchingItemFromDB.price,
    _id: undefined,
  };
});
```

Now we calculate the prices:

```js
const { itemsPrice, taxPrice, shippingPrice, totalPrice } =
  calcPrices(dbOrderItems);
```

And finally, we create the order and save it to the database:

```js
const order = new Order({
  orderItems: dbOrderItems,
  user: req.user._id,
  shippingAddress,
  paymentMethod,
  itemsPrice,
  taxPrice,
  shippingPrice,
  totalPrice,
});

const createdOrder = await order.save();

res.status(201).json(createdOrder);
```

## `updateOrderToPaid()` Function

Now we need to implement the functions that we created in the `paypal.js` file.

Replace the entire `updateOrderToPaid()` function with the following:

```js
const updateOrderToPaid = asyncHandler(async (req, res) => {
  const { verified, value } = await verifyPayPalPayment(req.body.id);
  if (!verified) throw new Error('Payment not verified');

  // check if this transaction has been used before
  const isNewTransaction = await checkIfNewTransaction(Order, req.body.id);
  if (!isNewTransaction) throw new Error('Transaction has been used before');

  const order = await Order.findById(req.params.id);

  if (order) {
    // check the correct amount was paid
    const paidCorrectAmount = order.totalPrice.toString() === value;
    if (!paidCorrectAmount) throw new Error('Incorrect amount paid');

    order.isPaid = true;
    order.paidAt = Date.now();
    order.paymentResult = {
      id: req.body.id,
      status: req.body.status,
      update_time: req.body.update_time,
      email_address: req.body.payer.email_address,
    };

    const updatedOrder = await order.save();

    res.json(updatedOrder);
  } else {
    res.status(404);
    throw new Error('Order not found');
  }
});
```

Let's go over this code block by block.

First, we verify the payment:

```js
const { verified, value } = await verifyPayPalPayment(req.body.id);
if (!verified) throw new Error('Payment not verified');
```

Then we check if this transaction has been used before:

```js
const isNewTransaction = await checkIfNewTransaction(Order, req.body.id);
if (!isNewTransaction) throw new Error('Transaction has been used before');
```

Then we get the order from the database:

```js
const order = await Order.findById(req.params.id);
```

Then we check if the correct amount was paid:

```js
const paidCorrectAmount = order.totalPrice.toString() === value;
if (!paidCorrectAmount) throw new Error('Incorrect amount paid');
```

And finally, we update the order and save it to the database:

```js
order.isPaid = true;
order.paidAt = Date.now();
order.paymentResult = {
  id: req.body.id,
  status: req.body.status,
  update_time: req.body.update_time,
  email_address: req.body.payer.email_address,
};

const updatedOrder = await order.save();

res.json(updatedOrder);
```

## Add `unwrap` in `orderScreen`

One final thing we need to do is go into `frontend/screens/orderScreen.js` and in the `onApprove` function, add `unwrap` to the `payOrder` function:

```js
await payOrder({ orderId, details }).unwrap();
```

Now you can test it out by placing an order. Everything should work as it did before, except the application is much more secure now.
