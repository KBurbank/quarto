-- Function to check if a block is a LaTeX raw block starting with "\begin{questions}"
local function is_questions_environment(block)
    return block.t == "RawBlock"
           and block.format == "tex"
           and block.text:match("^\\begin{questions}")
end

-- Main filter function
function Pandoc(doc)
    local has_questions_environment = false
    local first_question_index = nil

    -- Helper: does this block start a question?
    local function starts_question(block)
        if block.t == "RawBlock" and block.format == "tex" then
            if block.text:match("^\\question") or block.text:match("^\\titledquestion") then
                return true
            end
        end
        if (block.t == "Para" or block.t == "Plain") and block.c then
            for _, inline in ipairs(block.c) do
                if inline.t == "RawInline" and inline.format == "tex" then
                    if inline.text:match("^\\question") or inline.text:match("^\\titledquestion") then
                        return true
                    end
                end
            end
        end
        return false
    end

    -- Scan for existing questions environment and first question
    for i, block in ipairs(doc.blocks) do
     --   io.stderr:write(block.t .. " " .. pandoc.utils.stringify(block) .. "\n")
        if is_questions_environment(block) then
            has_questions_environment = true
            break
        end
        if not first_question_index and starts_question(block) then
            first_question_index = i
        end
    end

    -- If missing, insert begin before first question and end at document end
    if not has_questions_environment and first_question_index then
        table.insert(doc.blocks, first_question_index, pandoc.RawBlock("tex", "\\begin{questions}"))
        table.insert(doc.blocks, pandoc.RawBlock("tex", "\\end{questions}"))
    end

    return doc
end


-- titledquestions with points need to be marked as inline latex. This doesn't happen automatically in the next filter anymore because they are not inside the rawblock that would is typically created by the questions environment.

function Para(elem)
    if #elem.content == 2 then
        local first = elem.content[1]
        local second = elem.content[2]
        if first.t == "RawInline" and first.format == "tex" and
           first.text:match("^\\titledquestion") and
           second.t == "Str" and second.text:match("^%[%d+%]$") then
            local new_text = first.text .. second.text
            io.stderr:write(new_text .. "\n")
            return pandoc.Para({pandoc.RawInline("tex", new_text)})
        end
    end
end
