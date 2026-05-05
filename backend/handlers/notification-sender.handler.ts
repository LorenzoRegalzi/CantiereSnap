export const handler = async (event: { source: string }): Promise<void> => {
  // Triggered by EventBridge. event.source is 'overdue-alert' or 'invoice-reminder'.
  console.log('notification-sender placeholder', JSON.stringify(event));
};
