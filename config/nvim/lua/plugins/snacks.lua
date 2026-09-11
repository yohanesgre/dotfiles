-- Picker sources: list ALL files, including hidden and gitignored.
-- `hidden` passes --hidden, `ignored` passes --no-ignore to fd/rg.
return {
  {
    "folke/snacks.nvim",
    opts = {
      picker = {
        sources = {
          files = { hidden = true, ignored = true },
          grep = { hidden = true, ignored = true },
          grep_word = { hidden = true, ignored = true },
        },
      },
    },
  },
}
