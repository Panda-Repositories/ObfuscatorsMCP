const WYNF_STUBS = `if not WYNF_OBFUSCATED then
    WYNF_NO_VIRTUALIZE = function(fn) return fn end
    WYNF_JIT = function(fn) return fn end
    WYNF_JIT_MAX = function(fn) return fn end
    WYNF_CRASH = function() error("crash") end
    WYNF_IS_CALLER_WYNFUSCATE = function() return true end
    WYNF_ENC_STRING = function(str) return str end
    WYNF_ENC_NUM = function(n) return n end
    WYNF_LINE = function()
        if debug and debug.info then return debug.info(2, "l") end
        return 0
    end
    WYNF_NO_UPVALUES = function(fn) return fn end
    WYNF_SECURE_CALL = function(fn) return fn end
    WYNF_SECURE_CALLBACK = function(fn) return fn end
    WYNF_ENC_FUNC = function(fn) return fn end
    WYNF_ENC_FUNC_SEED = function(fn) return fn end
    WYNF_GET_RNG_SEED = function() return math.floor(os.clock() * 1000000) % 2147483648 end
    WYNF_GET_RNG = WYNF_GET_RNG_SEED
    WYNF_BEGIN_CLIENT_LINES = function() end
end`;

const LPH_STUBS = `if not LPH_OBFUSCATED then
    LPH_OBFUSCATED = false
    LPH_LINE = 0
    function LPH_ENCFUNC(fn) return fn end
    LPH_FUNCENC = LPH_ENCFUNC
    function LPH_ENCSTR(s) return s end
    LPH_STRENC = LPH_ENCSTR
    function LPH_ENCNUM(n) return n end
    LPH_NUMENC = LPH_ENCNUM
    function LPH_CRASH() error("LPH_CRASH") end
    function LPH_JIT(fn) return fn end
    LPH_JIT_MAX = LPH_JIT
    function LPH_NO_VIRTUALIZE(fn) return fn end
    function LPH_NO_UPVALUES(fn) return fn end
end`;

export function getStubs(provider) {
  switch (provider) {
    case "wynfuscator":
      return WYNF_STUBS;
    case "luraph":
      return LPH_STUBS;
    case "both":
    default:
      return `${WYNF_STUBS}\n\n${LPH_STUBS}`;
  }
}
