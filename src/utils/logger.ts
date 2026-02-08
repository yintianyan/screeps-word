const Logger = {
  log: (message: string, module = "System") => {
    console.log(`[${module}] ${message}`);
  },

  error: (message: string, module = "System") => {
    console.log(`<span style="color:red">[${module}] ERROR: ${message}</span>`);
  },

  highlight: (message: string) => {
    console.log(`<span style="color:cyan">${message}</span>`);
  },
};

export default Logger;
