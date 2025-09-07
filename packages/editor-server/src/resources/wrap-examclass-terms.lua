-- This file is used to mark certain commands used in the examclass package with backticks so that Pandoc will process them as raw LaTeX. Importantly, this stops Pandoc from processing the inside of the `questions` environment as a pure Latex block, allowing us to use Markdown instead. It also stops Pandoc from escaping  examClass macros which Pandoc doesn't recognize as Latex macros.

local environments = {"questions", "parts", "subparts", "subsubparts", "solution", "coverpages", "EnvFullwidth", "choices", "checkboxes", "multicolcheckboxes"}
local toDivEnvs = { parts = true, subparts = true, solution = true }

local function processRawBlocks(el)
    if el.format == "tex" then
        io.stderr:write("[wrap-examclass-terms] inspecting RawBlock\\n")
        -- Check if it's the start of a "questions" environment
        local begin_pattern = "\\begin{questions}"
        local end_pattern = "\\end{questions}"
        if el.text:match("^" .. begin_pattern) then
            io.stderr:write("[wrap-examclass-terms] matched questions begin\\n")
            -- Find the end of the environment
            local content_start = #begin_pattern + 1
            local content_end = el.text:find(end_pattern, content_start)
            if content_end then
                local content = el.text:sub(content_start, content_end - 1)

                -- Surround \part-like commands with backticks and {=latex}
                -- Use word boundary to ensure we only match \part as a complete command
                content = content:gsub("(\\part%b[])", "`%1`{=latex}")
                content = content:gsub("(\\part)([%s{}])", "`%1`{=latex}%2")  -- Only match when followed by space or brace
                content = content:gsub("(\\subpart%b[])", "`%1`{=latex}")
                content = content:gsub("(\\subpart)([%s{}])", "`%1`{=latex}%2")
                content = content:gsub("(\\subsubpart%b[])", "`%1`{=latex}")
                content = content:gsub("(\\subsubpart)([%s{}])", "`%1`{=latex}%2")

                -- Surround \titledquestion commands with backticks and {=latex}
                content = content:gsub("(\\titledquestion%b{}%b[])", "`%1`{=latex}")
                content = content:gsub("(\\titledquestion%b{})([^[])", "`%1`{=latex}%2")

                -- Loop through environments and surround \begin and \end with backticks
                -- EXCEPT for those we plan to convert to Divs (toDivEnvs)
                for _, env in ipairs(environments) do
                    if not toDivEnvs[env] then
                        -- Handle \begin{env} with optional square bracket argument
                        content = content:gsub("(\\begin{" .. env .. "}%b[])", "`%1`{=latex}")
                        -- Handle \begin{env} without square brackets
                        content = content:gsub("(\\begin{" .. env .. "})([^[])", "`%1`{=latex}%2")
                        -- Handle \end{env}
                        content = content:gsub("(\\end{" .. env .. "})", "`%1`{=latex}")
                    end
                end


                -- Process the content inside the environment
                local doc = pandoc.read(content, "markdown")

                -- Convert selected LaTeX environments within questions to Divs (so they write as ::: env)
                local function begin_name(block)
                    if type(block) == 'table' and block.t == 'RawBlock' and type(block.c) == 'table' then
                        local fmt = block.c[1]
                        local txt = block.c[2]
                        if (fmt == 'latex' or fmt == 'tex') and type(txt) == 'string' then
                            local name = string.match(txt, "^\\\\begin{([%w_]+)}")
                            return name
                        end
                    end
                    return nil
                end
                local function is_end(block, name)
                    if type(block) == 'table' and block.t == 'RawBlock' and type(block.c) == 'table' then
                        local fmt = block.c[1]
                        local txt = block.c[2]
                        if (fmt == 'latex' or fmt == 'tex') and type(txt) == 'string' then
                            if string.match(txt, "^\\\\end{" .. name .. "}") then return true end
                        end
                    end
                    return false
                end

                local blocks = doc.blocks
                local out = pandoc.List{}
                local i = 1
                while i <= #blocks do
                    local name = begin_name(blocks[i])
                    if name and toDivEnvs[name] then
                        -- accumulate until matching end
                        local inner = pandoc.List{}
                        i = i + 1
                        while i <= #blocks and not is_end(blocks[i], name) do
                            inner:insert(blocks[i])
                            i = i + 1
                        end
                        -- skip the end para if present
                        if i <= #blocks and is_end(blocks[i], name) then
                            i = i + 1
                        end
                        out:insert(pandoc.Div(inner, pandoc.Attr('', { name }, {})))
                    else
                        out:insert(blocks[i])
                        i = i + 1
                    end
                end

                local processed_content = out
                -- Wrap the processed content with the environment tags
                table.insert(processed_content, 1, pandoc.RawBlock("tex", begin_pattern))
                table.insert(processed_content, pandoc.RawBlock("tex", end_pattern))
                return processed_content
            end
        end
    end
    -- If it's not a "questions" environment, return the original element
    return el
end

-- Apply the function to all RawBlocks
return {
    {RawBlock = processRawBlocks}
}
