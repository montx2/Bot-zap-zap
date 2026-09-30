function noop(){return undefined;}
function pino(){return {trace:noop,debug:noop,info:noop,warn:noop,error:noop,fatal:noop,child(){return this}};}
pino.stdTimeFunctions={isoTime:()=>new Date().toISOString()};
export default pino;
