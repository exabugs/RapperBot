require "rhymer"

rhymer = Rhymer::Parser.new(ARGV[0])
rhymer.rhymes.each do |rhyme|
  puts [rhyme[0], rhyme[1]].join(" ")

end