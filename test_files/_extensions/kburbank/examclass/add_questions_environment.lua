-- Function to check if a block is a LaTeX raw block starting with "\begin{questions}"
local function is_questions_environment(block)
    return block.t == "RawBlock" 
           and block.format == "tex" 
           and block.text:match("^\\begin{questions}")
end

-- Main filter function
function Pandoc(doc)
    local has_questions_environment = false
    
    -- Check if there's already a questions environment
    for _, block in ipairs(doc.blocks) do
     --   io.stderr:write(block.t .. " " .. pandoc.utils.stringify(block) .. "\n")
        if is_questions_environment(block) then
            has_questions_environment = true
            break
        end
    end
    
    -- If there's no questions environment, add it
    if not has_questions_environment then
        table.insert(doc.blocks, 1, pandoc.RawBlock("tex", "\\begin{questions}"))
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