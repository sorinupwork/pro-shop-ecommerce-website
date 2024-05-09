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

  // Calculate the total price
  const totalPrice = (Number(itemsPrice) + Number(shippingPrice)).toFixed(2);
  return { itemsPrice, shippingPrice, totalPrice };
}
