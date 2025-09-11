-- Convert Divs marked as 'part' (either class .part or id 'part')
-- into LaTeX commands based on explicit nesting we compute.
-- Depth 1: \question, 2: \part, 3: \subpart, 4+: \subsubpart

-- Determine the LaTeX command for the given depth
local function command_for_depth(d)
  if d <= 1 then return '\\question' end
  if d == 2 then return '\\part' end
  if d == 3 then return '\\subpart' end
  return '\\subsubpart'
end

-- Check if a string is non-empty after trimming whitespace
local function has_text(s)
  return type(s) == 'string' and s:match('%S') ~= nil
end

-- Return numeric points string if valid (e.g., "3", "2.5"), otherwise nil
local function normalize_points(p)
  if not p then return nil end
  if type(p) ~= 'string' then p = tostring(p) end
  -- trim
  p = p:match('^%s*(.-)%s*$')
  -- accept integers or decimals only (no units)
  if p:match('^%d+%.?%d*$') then
    return p
  end
  return nil
end

-- Identify a 'part' Div: either class .part or id 'part'
local function is_part_div(block)
  if block.t ~= 'Div' then return false end
  local has_class = block.classes and block.classes:includes('part')
  local has_id = block.identifier and block.identifier == 'part'
  return has_class or has_id
end

-- Identify a 'solution' Div by class .solution (ignore other classes like .collapsed)
local function is_solution_div(block)
  if block.t ~= 'Div' then return false end
  if not block.classes then return false end
  return block.classes:includes('solution') or block.classes:includes('examsolution')
end

-- Map child depth to environment name
local function env_for_child_depth(d)
  if d == 2 then return 'parts' end
  if d == 3 then return 'subparts' end
  if d >= 4 then return 'subsubparts' end
  return nil
end

-- Transform blocks recursively, carrying explicit depth
local function transform_blocks(blocks, current_depth)
  local output = pandoc.List:new()

  local i = 1
  while i <= #blocks do
    local b = blocks[i]
    if is_part_div(b) then
      local new_depth = current_depth + 1
      local title = b.attributes and b.attributes.title
      local points = nil
      if b.attributes then
        points = b.attributes.points or b.attributes.point or b.attributes.pts or b.attributes.p
      end
      points = normalize_points(points)
      local bracket = ''
      if points and points ~= '' then
        bracket = '[' .. points .. ']'
      end
      local cmdline
      if new_depth == 1 then
        if has_text(title) then
          cmdline = '\\titledquestion{' .. title .. '}' .. bracket
        else
          cmdline = '\\question' .. bracket
        end
      else
        cmdline = command_for_depth(new_depth) .. bracket
      end
      output:insert(pandoc.RawBlock('tex', cmdline))

      -- Scan direct child blocks; group consecutive child parts into env
      local child_blocks = b.content or pandoc.List:new()
      local j = 1
      while j <= #child_blocks do
        local cb = child_blocks[j]
        if is_part_div(cb) then
          local k = j
          while k <= #child_blocks and is_part_div(child_blocks[k]) do
            k = k + 1
          end
          local env = env_for_child_depth(new_depth + 1)
          if env then
            output:insert(pandoc.RawBlock('tex', '\\begin{' .. env .. '}'))
          end
          for x = j, k - 1 do
            local transformed = transform_blocks({ child_blocks[x] }, new_depth)
            for y = 1, #transformed do
              output:insert(transformed[y])
            end
          end
          if env then
            output:insert(pandoc.RawBlock('tex', '\\end{' .. env .. '}'))
          end
          j = k
        else
          local transformed = transform_blocks({ cb }, new_depth)
          for y = 1, #transformed do
            output:insert(transformed[y])
          end
          j = j + 1
        end
      end
    else
      -- Non-part blocks: recurse to catch nested parts further down
      if b.t == 'Div' then
        if is_solution_div(b) then
          -- Emit solution environment with optional [space]
          local space = nil
          if b.attributes then
            space = b.attributes.space or b.attributes["data-space"] or b.attributes.sp
          end
          if (not space) and b.attr and b.attr.attributes then
            local attrs = b.attr.attributes
            -- Try direct key lookup then fall back to iterating key/value pairs
            space = attrs.space or attrs["data-space"] or attrs.sp or space
            if (not space) and type(attrs) == 'table' then
              for k, v in pairs(attrs) do
                if k == 'space' or k == 'data-space' or k == 'sp' then
                  space = v
                  break
                end
                if type(v) == 'table' and v[1] and v[2] then
                  local key = v[1]
                  local val = v[2]
                  if key == 'space' or key == 'data-space' or key == 'sp' then
                    space = val
                    break
                  end
                end
              end
            end
          end
          local sbracket = ''
          if space and space ~= '' then
            sbracket = '[' .. space .. ']'
          end
          output:insert(pandoc.RawBlock('tex', '\\begin{solution}' .. sbracket))
          local transformed_children = transform_blocks(b.content or pandoc.List:new(), current_depth)
          for y = 1, #transformed_children do
            output:insert(transformed_children[y])
          end
          output:insert(pandoc.RawBlock('tex', '\\end{solution}'))
        else
          -- Reconstruct Div with transformed children
          local transformed_children = transform_blocks(b.content or pandoc.List:new(), current_depth)
          local new_div = pandoc.Div(transformed_children, b.attr)
          output:insert(new_div)
        end
      else
        output:insert(b)
      end
    end
    i = i + 1
  end

  return output
end

function Pandoc(doc)
  doc.blocks = transform_blocks(doc.blocks, 0)

  -- Relocate any preface content so that \begin{questions} is
  -- immediately followed by the first \question/\titledquestion.
  local function relocate_questions_preface(blocks)
    local out = pandoc.List:new()
    local i = 1
    while i <= #blocks do
      local b = blocks[i]
      if b.t == 'RawBlock' and b.format == 'tex' and b.text:match('^\\begin%{questions%}%s*$') then
        local j = i + 1
        local inside = pandoc.List:new()
        while j <= #blocks do
          local bb = blocks[j]
          if bb.t == 'RawBlock' and bb.format == 'tex' and bb.text:match('^\\end%{questions%}%s*$') then
            break
          end
          inside:insert(bb)
          j = j + 1
        end

        local firstIdx = nil
        for k = 1, #inside do
          local bb = inside[k]
          if bb.t == 'RawBlock' and bb.format == 'tex' then
            if bb.text:match('^\\titledquestion') or bb.text:match('^\\question') then
              firstIdx = k
              break
            end
          end
        end

        if firstIdx and firstIdx > 1 then
          for k = 1, firstIdx - 1 do
            out:insert(inside[k])
          end
          out:insert(b)
          for k = firstIdx, #inside do
            out:insert(inside[k])
          end
        else
          out:insert(b)
          for k = 1, #inside do
            out:insert(inside[k])
          end
        end

        if j <= #blocks then
          out:insert(blocks[j])
          i = j + 1
        else
          i = j
        end
      else
        out:insert(b)
        i = i + 1
      end
    end
    return out
  end

  doc.blocks = relocate_questions_preface(doc.blocks)
  return doc
end
