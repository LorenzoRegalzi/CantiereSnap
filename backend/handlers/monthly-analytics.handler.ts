export const handler = async (event: { source: string }): Promise<void> => {
  // Triggered by EventBridge on the 1st of each month. event.source is 'monthly-analytics'.
  console.log('monthly-analytics placeholder', JSON.stringify(event));
};
