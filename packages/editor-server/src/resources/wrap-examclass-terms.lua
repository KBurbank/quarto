-- Lua filter to allow Markdown inside specific LaTeX environments by preserving
-- the outer \begin{questions} ... \end{questions} while parsing inner content.

local environments = {"questions", "parts", "subparts", "subsubparts", "solution", "coverpages", "EnvFullwidth", "choices", "checkboxes", "multicolcheckboxes"}

local function processRawBlocks(el)
  if el.format == "tex" then
    local begin_pattern = "\\begin{questions}"
    local end_pattern = "\\end{questions}"
    if el.text:match("^" .. begin_pattern) then
      local content_start = #begin_pattern + 1
      local content_end = el.text:find(end_pattern, content_start)
      if content_end then
        local content = el.text:sub(content_start, content_end - 1)

        -- Protect selected commands/environments so Pandoc keeps them as raw LaTeX
        content = content:gsub("(\\part%b[])", "`%1`{=latex}")
        content = content:gsub("(\\part)([%s{}])", "`%1`{=latex}%2")
        content = content:gsub("(\\titledquestion%b{}%b[])", "`%1`{=latex}")
        content = content:gsub("(\\titledquestion%b{})([^[])", "`%1`{=latex}%2")
        for _, env in ipairs(environments) do
          content = content:gsub("(\\begin{" .. env .. "}%b[])", "`%1`{=latex}")
          content = content:gsub("(\\begin{" .. env .. "})([^[])", "`%1`{=latex}%2")
          content = content:gsub("(\\end{" .. env .. "})", "`%1`{=latex}")
        end

        local processed_blocks = pandoc.read(content, "markdown").blocks
        table.insert(processed_blocks, 1, pandoc.RawBlock("tex", begin_pattern))
        table.insert(processed_blocks, pandoc.RawBlock("tex", end_pattern))
        return processed_blocks
      end
    end
  end
  return nil
end

return {
  { RawBlock = processRawBlocks }
}

