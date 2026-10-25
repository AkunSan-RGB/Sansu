

const list = (rows: string[]) => rows.slice(0, 6).join(', ') + (rows.length > 6 ? `, dan ${rows.length - 6} lainnya` : '');
